import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/db';
import { seed } from '../src/seed';
import { createApp } from '../src/app';
import { agentRequest, overspendAttack, retryRequest, tamperDelivery, verifyDelivery, buildReceipt } from '../src/engine';
import { hashArtifact } from '../src/canonical';
import { getPolicy } from '../src/policy';
import { assertTransition, STATES } from '../src/payments';

function freshDb() {
  const db = openDb(':memory:');
  seed(db);
  return db;
}

const SVC = { translation: 1, compute: 2, storage: 3, premium: 4 };

test('1. payment under budget succeeds', () => {
  const db = freshDb();
  const r = agentRequest(db, { serviceId: SVC.translation });
  assert.equal(r.outcome, 'PAID_DELIVERED_VERIFIED');
  assert.equal(r.chargedDollars, 2);
  assert.equal(getPolicy(db, 1)!.spentCents, 200);
});

test('2. payment exactly equal to remaining budget succeeds', () => {
  const db = freshDb();
  agentRequest(db, { serviceId: SVC.translation }); // $2 -> remaining $8
  const r = agentRequest(db, { serviceId: SVC.premium }); // exactly $8
  assert.equal(r.outcome, 'PAID_DELIVERED_VERIFIED');
  const p = getPolicy(db, 1)!;
  assert.equal(p.spentCents, 1000);
  assert.equal(p.remainingCents, 0);
});

test('3. payment above budget is rejected', () => {
  const db = freshDb();
  const r = overspendAttack(db, { amountDollars: 11 });
  assert.equal(r.outcome, 'BLOCKED_BUDGET');
  assert.equal(r.paymentStatus, STATES.REJECTED_BUDGET);
  assert.equal(r.reason, 'HARD_BUDGET_LIMIT_EXCEEDED');
});

test('4. overspend cannot bypass enforcement (agent is allowed to TRY, layer blocks it)', () => {
  const db = freshDb();
  agentRequest(db, { serviceId: SVC.premium }); // $8 -> remaining $2
  const attack = overspendAttack(db, { amountDollars: 5 }); // agent tries $5
  assert.equal(attack.outcome, 'BLOCKED_BUDGET');
  assert.equal(attack.enforcement, 'HARD_CAP');
  assert.equal(attack.agentControl, 'NONE');
  assert.equal(getPolicy(db, 1)!.spentCents, 800, 'spent must remain $8');
});

test('5. duplicate idempotency key returns original payment, no second charge (HTTP)', async () => {
  const db = freshDb();
  const app = createApp(db);
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const body = { requestId: 'req_dup_1', idempotencyKey: 'idem_dup_1', serviceId: SVC.translation };
    const first = await fetch(`${base}/api/payment`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(first.status, 200);
    const firstJson: any = await first.json();
    assert.equal(firstJson.duplicate, false);
    assert.equal(firstJson.chargedDollars, 2);

    const second = await fetch(`${base}/api/payment`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(second.status, 200);
    const secondJson: any = await second.json();
    assert.equal(secondJson.duplicate, true);
    assert.equal(secondJson.chargedDollars, 0);
    assert.equal(secondJson.payment.id, firstJson.payment.id);
    assert.equal(getPolicy(db, 1)!.spentCents, 200, 'only one charge');
  } finally {
    server.close();
  }
});

test('6. retry after network failure returns original payment with $0 charge', () => {
  const db = freshDb();
  const first = agentRequest(db, { serviceId: SVC.compute, simulateNetworkFailure: true });
  assert.equal(first.outcome, 'NETWORK_FAILURE');
  assert.equal(first.chargedDollars, 4);
  assert.equal(getPolicy(db, 1)!.spentCents, 400);

  const retry = retryRequest(db, { requestId: first.requestId, idempotencyKey: first.idempotencyKey });
  assert.equal(retry.outcome, 'IDEMPOTENT_RETRY');
  assert.equal(retry.chargedDollars, 0);
  assert.equal(retry.reason, 'IDEMPOTENT RETRY');
  assert.ok(retry.delivery, 'delivery received on retry');
  assert.equal(getPolicy(db, 1)!.spentCents, 400, 'no second charge');
  assert.equal(retry.receipt?.finalStatus, 'VERIFIED');
});

test('7. delivery hash generation matches independent recomputation', () => {
  const db = freshDb();
  const r = agentRequest(db, { serviceId: SVC.translation });
  const delivery = r.delivery!;
  const recomputed = hashArtifact(JSON.parse(delivery.result));
  assert.equal(delivery.contentHash, recomputed);
  assert.ok(delivery.contentHash.startsWith('sha256:'));
});

test('8. valid verification passes (VERA executes the proof)', () => {
  const db = freshDb();
  const r = agentRequest(db, { serviceId: SVC.premium });
  const v = verifyDelivery(db, r.delivery!.id);
  assert.equal(v.deliveryStatus, 'VERIFIED');
  assert.equal(v.hashValid, true);
  assert.equal(v.vera.verdict, 'CLAIM_VERIFIED');
  assert.equal(v.vera.mode, 'EXECUTABLE');
  assert.match(v.vera.observedResult, /clamp\(-5\) -> -5/);
  assert.equal(v.receipt.finalStatus, 'VERIFIED');
});

test('9. tampered artifact fails verification', () => {
  const db = freshDb();
  const r = agentRequest(db, { serviceId: SVC.translation });
  const t = tamperDelivery(db, r.delivery!.id);
  assert.equal(t.verify.hashValid, false, 'hash must mismatch after tampering');
  assert.equal(t.verify.deliveryStatus, 'FAILED');
  assert.equal(t.verify.vera.verdict, 'CLAIM_NOT_VERIFIED');
  assert.equal(t.verify.receipt.finalStatus, 'FAILED');
});

test('10. audit event recorded on rejection', () => {
  const db = freshDb();
  overspendAttack(db, { amountDollars: 50 });
  const rows = db.prepare("SELECT * FROM audit_events WHERE type = 'OVERSPEND_BLOCKED'").all() as any[];
  assert.ok(rows.length >= 1, 'OVERSPEND_BLOCKED audit event exists');
  assert.match(rows[0].description, /blocked/i);
});

test('11. budget can never become negative', () => {
  const db = freshDb();
  agentRequest(db, { serviceId: SVC.premium }); // $8
  agentRequest(db, { serviceId: SVC.translation }); // $2 -> exactly $10
  overspendAttack(db, { amountDollars: 1 });
  overspendAttack(db, { amountDollars: 100 });
  const p = getPolicy(db, 1)!;
  assert.ok(p.spentCents >= 0, 'spent >= 0');
  assert.ok(p.spentCents <= p.maxBudgetCents, 'spent <= max budget');
  assert.equal(p.spentCents, 1000);
});

test('12. rejected payment does not increase spent', () => {
  const db = freshDb();
  const before = getPolicy(db, 1)!.spentCents;
  const r = overspendAttack(db, { amountDollars: 10.01 });
  assert.equal(r.outcome, 'BLOCKED_BUDGET');
  assert.equal(getPolicy(db, 1)!.spentCents, before);
});

test('13. real HTTP 402 flow: unpaid -> 402, pay, paid -> 200 with service result', async () => {
  const db = freshDb();
  const app = createApp(db);
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const reqId = 'req_http402';
    const unpaid = await fetch(`${base}/api/service/${SVC.translation}?requestId=${reqId}`);
    assert.equal(unpaid.status, 402);
    const unpaidBody: any = await unpaid.json();
    assert.equal(unpaidBody.paymentRequired, true);
    assert.equal(unpaidBody.amount, 2);
    assert.equal(unpaidBody.paymentEndpoint, '/api/payment');

    const pay = await fetch(`${base}/api/payment`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: reqId, idempotencyKey: 'idem_http402', serviceId: SVC.translation }),
    });
    assert.equal(pay.status, 200);

    const paid = await fetch(`${base}/api/service/${SVC.translation}?requestId=${reqId}`);
    assert.equal(paid.status, 200);
    const paidBody: any = await paid.json();
    assert.equal(paidBody.serviceResult.target, 'Hola mundo');
    assert.ok(paidBody.receipt.contentHash.startsWith('sha256:'));
  } finally {
    server.close();
  }
});

test('14. illegal payment state transitions are impossible', () => {
  assert.throws(() => assertTransition(STATES.VERIFIED, STATES.PAID));
  assert.throws(() => assertTransition(STATES.REJECTED_BUDGET, STATES.PAID));
  assert.throws(() => assertTransition(STATES.PAID, STATES.AUTHORIZED));
  assert.doesNotThrow(() => assertTransition(STATES.PAYMENT_REQUIRED, STATES.AUTHORIZED));
});

test('15. receipt combines payment proof + delivery proof + VERA verification + integrity hash', () => {
  const db = freshDb();
  const r = agentRequest(db, { serviceId: SVC.compute });
  const receipt = buildReceipt(db, r.paymentId);
  assert.equal(receipt.authorization.allowed, true);
  assert.equal(receipt.delivery.received, true);
  assert.equal(receipt.integrity.hashValid, true);
  assert.equal(receipt.verification!.verifier, 'VERA');
  assert.equal(receipt.verification!.verdict, 'CLAIM_VERIFIED');
  assert.equal(receipt.finalStatus, 'VERIFIED');
});