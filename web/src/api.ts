export interface Policy { maxBudgetDollars: number; spentDollars: number; remainingDollars: number; utilizationPct: number; currency: string; active: boolean }
export interface Service { id: number; name: string; priceDollars: number; providerName: string; description: string; veraMode: string }
export interface Txn { id: number; requestId: string; service: string; provider: string; amountDollars: number; status: string; verification: string | null; deliveryId: number | null; createdAt: string }
export interface Step { at: string; step: string; detail: string; data?: Record<string, unknown> }
export interface Dashboard {
  user: { name: string };
  agent: { id: number; name: string; status: string };
  policy: Policy | null;
  counts: { settledPayments: number; verifiedDeliveries: number; blockedAttempts: number; failedVerifications: number; duplicateBlocks: number };
  services: Service[];
  transactions: Txn[];
}
export interface AuditEvent { id: number; type: string; requestId: string | null; paymentId: number | null; description: string; metadata: Record<string, unknown>; timestamp: string }
export interface Delivery {
  id: number; paymentId: number; requestId: string; service: string | null; amountDollars: number;
  contentHash: string; verificationStatus: string; veraVerdict: string | null; verifiedAt: string | null; result: Record<string, unknown>;
}
export interface Receipt {
  paymentId: number; requestId: string; service: string | null; providerName: string | null;
  amountDollars: number; finalStatus: string;
  authorization: { budgetDollars: number; spentBeforeDollars: number; requestedDollars: number; remainingBeforeDollars: number; allowed: boolean };
  payment: { status: string; timestamp: string };
  delivery: { received: boolean; artifactHash: string | null };
  verification: { verifier: string; executionId: string; mode: string; claim: string; observedResult: string; verdict: string; status: string; evidence: Record<string, unknown> } | null;
  integrity: { hashAlgorithm: string; contentHash: string | null; recomputedHash: string | null; hashValid: boolean | null };
}

const j = async (r: Response) => {
  const body = await r.json();
  if (!r.ok && !('paymentRequired' in (body ?? {}))) throw new Error(body?.error || r.statusText);
  return body;
};

export const api = {
  dashboard: (): Promise<Dashboard> => fetch('/api/dashboard').then(j),
  audit: (): Promise<{ events: AuditEvent[] }> => fetch('/api/audit').then(j),
  deliveries: (): Promise<{ deliveries: Delivery[] }> => fetch('/api/deliveries').then(j),
  health: () => fetch('/api/health').then(j),
  reset: () => fetch('/api/reset', { method: 'POST' }).then(j),
  buy: (serviceId: number): Promise<any> => fetch('/api/agent/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceId }) }).then(j),
  buyFail: (serviceId: number): Promise<any> => fetch('/api/agent/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceId, simulateNetworkFailure: true }) }).then(j),
  retry: (requestId: string, idempotencyKey: string): Promise<any> => fetch('/api/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId, idempotencyKey }) }).then(j),
  overspend: (amountDollars: number): Promise<any> => fetch('/api/attack/overspend', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amountDollars }) }).then(j),
  verify: (deliveryId: number): Promise<any> => fetch('/api/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deliveryId }) }).then(j),
  tamper: (deliveryId: number): Promise<any> => fetch('/api/attack/tamper', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deliveryId }) }).then(j),
  receipt: (paymentId: number): Promise<{ receipt: Receipt }> => fetch(`/api/receipt/${paymentId}`).then(j),
  service402: (serviceId: number, requestId: string): Promise<Response> => fetch(`/api/service/${serviceId}?requestId=${requestId}`),
};