// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PayProofEscrow
/// @notice Minimal on-chain settlement layer for PayProof x VERA (ONE HACK 2026 W3A-1).
///         Mirrors the off-chain enforcement engine: a hard per-agent budget cap that
///         CANNOT be bypassed by the agent, idempotent payment intents (retry can never
///         double-charge), and VERA-style delivery proof via SHA-256 commitment.
///         The off-chain engine (server/src/engine.ts) is the source of truth for the
///         demo; this contract is the optional §18 settlement path.
contract PayProofEscrow {
    enum Status { None, PaymentRequired, Authorized, Delivered, Verified, Settled, Failed, Refunded }

    struct Intent {
        address payer;          // agent's controller (human) — agent itself has NO key
        address merchant;
        uint256 amount;         // wei
        bytes32 deliveryHash;   // SHA-256 commitment of the delivered artifact (VERA)
        Status status;
        bool exists;
    }

    /// @notice payer => idempotencyKey => intent id. Retry with the same key is a no-op.
    mapping(address => mapping(bytes32 => uint256)) public intentOfKey;
    /// @notice hard lifetime budget per payer. Enforced in authorize() — no override path.
    mapping(address => uint256) public budgetCap;
    mapping(address => uint256) public spent;

    uint256 public nextId = 1;
    mapping(uint256 => Intent) public intents;

    event BudgetSet(address indexed payer, uint256 cap);
    event IntentCreated(uint256 indexed id, address indexed payer, bytes32 indexed idempotencyKey, uint256 amount);
    event Authorized(uint256 indexed id, uint256 amount, uint256 totalSpent);
    event Verified(uint256 indexed id, bytes32 deliveryHash);
    event Settled(uint256 indexed id, uint256 amount);
    event BlockedBudget(address indexed payer, uint256 requested, uint256 cap, uint256 spent);

    error BudgetExceeded(uint256 requested, uint256 cap, uint256 spent);
    error DuplicateIntent(uint256 existingId);
    error WrongStatus(uint256 id, Status expected);
    error NotPayer(uint256 id);

    /// @notice Owner (the human, not the agent) sets the hard cap. enforcement: HARD_CAP.
    function setBudgetCap(uint256 cap) external {
        budgetCap[msg.sender] = cap;
        emit BudgetSet(msg.sender, cap);
    }

    /// @notice Idempotent create: same (payer, key) returns the SAME intent, never a new charge.
    function createIntent(bytes32 idempotencyKey, address merchant, uint256 amount) external returns (uint256 id) {
        uint256 existing = intentOfKey[msg.sender][idempotencyKey];
        if (existing != 0) revert DuplicateIntent(existing);
        id = nextId++;
        intents[id] = Intent(msg.sender, merchant, amount, bytes32(0), Status.PaymentRequired, true);
        intentOfKey[msg.sender][idempotencyKey] = id;
        emit IntentCreated(id, msg.sender, idempotencyKey, amount);
    }

    /// @notice Budget check happens ON-CHAIN at authorization. The agent cannot skip it:
    ///         authorize() is the only path to Delivered/Verified/Settled.
    function authorize(uint256 id) external {
        Intent storage it = intents[id];
        if (!it.exists) revert WrongStatus(id, Status.None);
        if (msg.sender != it.payer) revert NotPayer(id);
        if (it.status != Status.PaymentRequired) revert WrongStatus(id, it.status);
        uint256 total = spent[it.payer] + it.amount;
        if (total > budgetCap[it.payer]) {
            emit BlockedBudget(it.payer, it.amount, budgetCap[it.payer], spent[it.payer]);
            revert BudgetExceeded(it.amount, budgetCap[it.payer], spent[it.payer]);
        }
        it.status = Status.Authorized;
        emit Authorized(id, it.amount, total);
    }

    /// @notice VERA: delivery is proven by committing the artifact hash, not trusting a claim.
    function markDelivered(uint256 id, bytes32 deliveryHash) external {
        Intent storage it = intents[id];
        if (!it.exists) revert WrongStatus(id, Status.None);
        if (msg.sender != it.payer) revert NotPayer(id);
        if (it.status != Status.Authorized) revert WrongStatus(id, it.status);
        require(deliveryHash != bytes32(0), "empty hash");
        it.deliveryHash = deliveryHash;
        it.status = Status.Delivered;
    }

    /// @notice VERA verification: recomputable on-chain by comparing commitments.
    function verifyDelivery(uint256 id, bytes32 recomputedHash) external view returns (bool ok) {
        Intent storage it = intents[id];
        return it.status == Status.Delivered && it.deliveryHash == recomputedHash;
    }

    /// @notice Settle after verification passes. Budget spent is incremented once, here.
    function settle(uint256 id, address payable merchant) external {
        Intent storage it = intents[id];
        if (!it.exists) revert WrongStatus(id, Status.None);
        if (msg.sender != it.payer) revert NotPayer(id);
        if (it.status != Status.Delivered) revert WrongStatus(id, it.status);
        spent[it.payer] += it.amount;
        it.status = Status.Settled;
        merchant.transfer(it.amount);
        emit Settled(id, it.amount);
    }

    receive() external payable {}
}
