import type { DatabaseSync } from 'node:sqlite';
import { asNumber } from './db';

export interface PolicyView {
  id: number;
  agentId: number;
  maxBudgetCents: number;
  spentCents: number;
  remainingCents: number;
  currency: string;
  active: boolean;
}

export function getPolicy(db: DatabaseSync, agentId: number): PolicyView | null {
  const r = db.prepare('SELECT * FROM policies WHERE agent_id = ?').get(agentId) as any;
  if (!r) return null;
  return {
    id: asNumber(r.id),
    agentId: asNumber(r.agent_id),
    maxBudgetCents: asNumber(r.max_budget_cents),
    spentCents: asNumber(r.spent_cents),
    remainingCents: asNumber(r.max_budget_cents) - asNumber(r.spent_cents),
    currency: r.currency,
    active: asNumber(r.active) === 1,
  };
}

export function setPolicy(db: DatabaseSync, agentId: number, maxBudgetCents: number): PolicyView {
  db.prepare(
    `INSERT INTO policies (agent_id, max_budget_cents, spent_cents, currency, active)
     VALUES (?, ?, 0, 'USD', 1)
     ON CONFLICT(agent_id) DO UPDATE SET max_budget_cents = excluded.max_budget_cents, spent_cents = 0, active = 1`,
  ).run(agentId, maxBudgetCents);
  return getPolicy(db, agentId)!;
}

export type DebitResult =
  | { ok: true; spentBefore: number; spentAfter: number; remainingBefore: number }
  | { ok: false; reason: 'POLICY_NOT_FOUND' | 'POLICY_INACTIVE' | 'HARD_BUDGET_LIMIT_EXCEEDED'; maxBudgetCents: number; spentCents: number; remainingCents: number };

/**
 * THE enforcement boundary. The agent is never asked whether it can afford
 * something — this function decides, and the conditional UPDATE guarantees the
 * cap holds even under concurrent attempts. Budget can never go negative.
 */
export function tryDebit(db: DatabaseSync, agentId: number, amountCents: number): DebitResult {
  const p = getPolicy(db, agentId);
  if (!p) {
    return { ok: false, reason: 'POLICY_NOT_FOUND', maxBudgetCents: 0, spentCents: 0, remainingCents: 0 };
  }
  if (!p.active) {
    return { ok: false, reason: 'POLICY_INACTIVE', maxBudgetCents: p.maxBudgetCents, spentCents: p.spentCents, remainingCents: p.remainingCents };
  }
  if (amountCents > p.remainingCents) {
    return { ok: false, reason: 'HARD_BUDGET_LIMIT_EXCEEDED', maxBudgetCents: p.maxBudgetCents, spentCents: p.spentCents, remainingCents: p.remainingCents };
  }
  const res = db.prepare(
    'UPDATE policies SET spent_cents = spent_cents + ? WHERE agent_id = ? AND active = 1 AND spent_cents + ? <= max_budget_cents',
  ).run(amountCents, agentId, amountCents);
  if (asNumber(res.changes) !== 1) {
    const after = getPolicy(db, agentId)!;
    return { ok: false, reason: 'HARD_BUDGET_LIMIT_EXCEEDED', maxBudgetCents: after.maxBudgetCents, spentCents: after.spentCents, remainingCents: after.remainingCents };
  }
  return { ok: true, spentBefore: p.spentCents, spentAfter: p.spentCents + amountCents, remainingBefore: p.remainingCents };
}

export function credit(db: DatabaseSync, agentId: number, amountCents: number): void {
  db.prepare('UPDATE policies SET spent_cents = MAX(0, spent_cents - ?) WHERE agent_id = ?').run(amountCents, agentId);
}