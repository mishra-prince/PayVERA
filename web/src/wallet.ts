import { createPublicClient, createWalletClient, custom, formatEther, parseEther, http } from 'viem';
import { sepolia } from 'viem/chains';
import type { Abi } from 'viem';

/**
 * PayVERA real-wallet layer (viem + MetaMask via EIP-1193 `window.ethereum`).
 *
 * NO private keys, NO seed phrases, NO passwords — ever. Signing happens
 * inside MetaMask; this module only talks to the provider the user connects.
 */

declare global {
  interface Window { ethereum?: any }
}

export const PAYVERA_ABI = [
  {
    type: 'function', name: 'pay', stateMutability: 'nonpayable',
    inputs: [
      { name: 'idempotencyKey', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'destination', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'fund', stateMutability: 'nonpayable',
    inputs: [], outputs: [],
  },
  {
    type: 'function', name: 'setMaxTransaction', stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }], outputs: [],
  },
  {
    type: 'function', name: 'authorizeAgent', stateMutability: 'nonpayable',
    inputs: [{ name: 'agent', type: 'address' }], outputs: [],
  },
  {
    type: 'function', name: 'remaining', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'budget', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'spent', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'maxTransaction', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'owner', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function', name: 'merchant', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function', name: 'authorityActive', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function', name: 'authorizedAgents', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function', name: 'checkPayment', stateMutability: 'view',
    inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ name: 'verdict', type: 'string' }],
  },
  {
    type: 'event', name: 'Paid',
    inputs: [
      { name: 'idempotencyKey', type: 'bytes32', indexed: true },
      { name: 'agent', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'totalSpent', type: 'uint256', indexed: false },
    ],
  },
] as Abi;

export const SEPOLIA_CHAIN_ID = 11155111;
export const ETHERSCAN = 'https://sepolia.etherscan.io';

export function hasWallet(): boolean {
  return typeof window !== 'undefined' && !!window.ethereum;
}

export async function connectWallet(): Promise<{ address: string; chainId: number }> {
  if (!window.ethereum) throw new Error('NO_WALLET: MetaMask (or any EVM browser wallet) is not installed');
  const accounts: string[] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const chainIdHex: string = await window.ethereum.request({ method: 'eth_chainId' });
  return { address: accounts[0], chainId: parseInt(chainIdHex, 16) };
}

export async function ensureSepolia(): Promise<void> {
  const chainIdHex: string = await window.ethereum.request({ method: 'eth_chainId' });
  if (parseInt(chainIdHex, 16) === SEPOLIA_CHAIN_ID) return;
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0xaa36a7' }],
    });
  } catch (e: any) {
    if (e?.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0xaa36a7',
          chainName: 'Sepolia',
          nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://rpc.sepolia.org'],
          blockExplorerUrls: [ETHERSCAN],
        }],
      });
    } else throw e;
  }
}

export function walletClient(): any {
  if (!window.ethereum) throw new Error('NO_WALLET');
  return createWalletClient({ chain: sepolia, transport: custom(window.ethereum) });
}

export function publicClient(): any {
  return createPublicClient({ chain: sepolia, transport: http('https://rpc.sepolia.org') });
}

export const eth = (n: string) => parseEther(n, 'wei' as any) as unknown as bigint;
export const fmtEth = (wei: bigint) => Number(formatEther(wei));

export async function walletBalance(address: string): Promise<bigint> {
  return (await publicClient().getBalance({ address })) as bigint;
}

export function txUrl(hash: string): string {
  return `${ETHERSCAN}/tx/${hash}`;
}

export function addrUrl(addr: string): string {
  return `${ETHERSCAN}/address/${addr}`;
}

export function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
