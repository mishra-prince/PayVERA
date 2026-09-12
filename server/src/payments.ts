import type { DatabaseSync } from 'node:sqlite';
import { asNumber, nowIso } from './db';

export const STATES = {
  REQUESTED: 'REQUESTED',
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  AUTHORIZED: 'AUTHORIZED',
  PAID: 'PAID',
  DELIVERED: 'DELIVERED',
  VERIFIED: 'VERIFIED',
  REJECTED_BUDGET: 'REJECTED_BUDGET',
  REJECTED_DUPLICATE: 'REJECTED_DUPLICATE',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
} as const;

export type PaymentStatus = (typeof STATES)[keyof typeof STATES];

const TRANSITIONS: Record<string, string[]> = {
  REQUESTED: ['PAYMENT_REQUIRED', 'FAILED', 'EXPIRED'],
  PAYMENT_REQUIRED: ['AUTHORIZED', 'REJECTED_BUDGET', 'FAILED', 'EXPIRED'],
  AUTHORIZED: ['PAID', 'FAILED'],
  PAID: ['DELIVERED'],
  DELIVERED: ['VERIFIED'],
  VERIFIED: [],
  REJECTED_BUDGET: [],
  REJECTED_DUPLICATE: [],
  FAILED: [],
  EXPIRED: [],
};

export class IllegalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`ILLEGAL_PAYMENT_STATE_TRANSITION: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function assertTransition(from: string, to: string): void {
  if (!TRANSITIONS[from]?.includes(to)) throw new IllegalTransitionError(from, to);
}

export interface PaymentRow {
  id: number;
  requestId: string;
  idempotencyKey: string;
  agentId: number;
  providerId: number | null;
  serviceId: number | null;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  attempt: number;
  spentBeforeCents: number;
  remainingBeforeCents: number;
  createdAt: string;
}

function rowToPayment(r: any): PaymentRow {
  return {
    id: asNumber(r.id),
    requestId: r.request_id,
    idempotencyKey: r.idempotency_key,
    agentId: asNumber(r.agent_id),
    providerId: r.provider_id == null ? null : asNumber(r.provider_id),
    serviceId: r.service_id == null ? null : asNumber(r.service_id),
    amountCents: asNumber(r.amount_cents),
    currency: r.currency,
    status: r.status,
    attempt: asNumber(r.attempt),
    spentBeforeCents: asNumber(r.spent_before_cents),
    remainingBeforeCents: asNumber(r.remaining_before_cents),
    createdAt: r.created_at,
  };
}

export function createPayment(
  db: DatabaseSync,
  p: {
    requestId: string;
    idempotencyKey: string;
    agentId: number;
    providerId: number | null;
    serviceId: number | null;
    amountCents: number;
    spentBeforeCents: number;
    remainingBeforeCents: number;
  },
): PaymentRow {
  const id = asNumber(
    db.prepare(
      `INSERT INTO payments (request_id, idempotency_key, agent_id, provider_id, service_id, amount_cents, currency, status, attempt, spent_before_cents, remaining_before_cents, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, 1, ?, ?, ?)`,
    ).run(p.requestId, p.idempotencyKey, p.agentId, p.providerId, p.serviceId, p.amountCents, STATES.REQUESTED, p.spentBeforeCents, p.remainingBeforeCents, nowIso()).lastInsertRowid,
  );
  return getPayment(db, id)!;
}

export function getPayment(db: DatabaseSync, id: number): PaymentRow | null {
  const r = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  return r ? rowToPayment(r) : null;
}

export function findPaymentByRequestId(db: DatabaseSync, requestId: string): PaymentRow | null {
  const r = db.prepare('SELECT * FROM payments WHERE request_id = ?').get(requestId);
  return r ? rowToPayment(r) : null;
}

export function findPaymentByIdempotencyKey(db: DatabaseSync, key: string): PaymentRow | null {
  const r = db.prepare('SELECT * FROM payments WHERE idempotency_key = ?').get(key);
  return r ? rowToPayment(r) : null;
}

export function setPaymentStatus(db: DatabaseSync, id: number, to: PaymentStatus): PaymentRow {
  const current = getPayment(db, id);
  if (!current) throw new Error(`PAYMENT_NOT_FOUND: ${id}`);
  assertTransition(current.status, to);
  db.prepare('UPDATE payments SET status = ? WHERE id = ?').run(to, id);
  return getPayment(db, id)!;
}