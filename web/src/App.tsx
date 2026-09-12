import { useCallback, useEffect, useState } from 'react';
import { api, type AuditEvent, type Dashboard, type Delivery, type Receipt, type Step } from './api';

type Tab = 'overview' | 'agent' | 'market' | 'stream' | 'attack' | 'verify' | 'audit' | 'demo';

const money = (n: number | null | undefined) => `$${(n ?? 0).toFixed(2)}`;

const STATUS_STYLE: Record<string, string> = {
  VERIFIED: 'bg-pp-green/15 text-pp-green',
  CLAIM_VERIFIED: 'bg-pp-green/15 text-pp-green',
  PAID: 'bg-pp-blue/15 text-pp-blue',
  DELIVERED: 'bg-pp-blue/15 text-pp-blue',
  AUTHORIZED: 'bg-pp-blue/15 text-pp-blue',
  PAYMENT_REQUIRED: 'bg-pp-amber/15 text-pp-amber',
  REQUESTED: 'bg-white/10 text-pp-mut',
  UNVERIFIED: 'bg-white/10 text-pp-mut',
  REJECTED_BUDGET: 'bg-pp-red/15 text-pp-red',
  REJECTED_DUPLICATE: 'bg-pp-red/15 text-pp-red',
  FAILED: 'bg-pp-red/15 text-pp-red',
  CLAIM_NOT_VERIFIED: 'bg-pp-red/15 text-pp-red',
  EXECUTION_ERROR: 'bg-pp-amber/15 text-pp-amber',
};

function Badge({ s }: { s: string }) {
  return <span className={`chip ${STATUS_STYLE[s] ?? 'bg-white/10 text-pp-ink'}`}>{s}</span>;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'market', label: 'Marketplace' },
  { id: 'attack', label: 'Attack Lab' },
  { id: 'verify', label: 'Verification' },
  { id: 'stream', label: 'Transactions' },
  { id: 'audit', label: 'Audit Trail' },
  { id: 'demo', label: 'Demo' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [log, setLog] = useState<{ t: string; kind: string; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [attackAmount, setAttackAmount] = useState('8');
  const [attackResult, setAttackResult] = useState<any>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [lastRetry, setLastRetry] = useState<{ requestId: string; idempotencyKey: string } | null>(null);

  const refresh = useCallback(async () => {
    const [d, a, dl] = await Promise.all([api.dashboard(), api.audit(), api.deliveries()]);
    setDash(d);
    setEvents(a.events);
    setDeliveries(dl.deliveries);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setErr(String(e)));
  }, [refresh]);

  const pushLog = (text: string, kind = 'INFO') =>
    setLog((l) => [{ t: new Date().toLocaleTimeString(), kind, text }, ...l].slice(0, 200));

  const logSteps = (steps?: Step[]) => {
    if (!steps || steps.length === 0) return;
    const entries = steps.map((s) => ({ t: new Date(s.at).toLocaleTimeString(), kind: s.step, text: s.detail }));
    setLog((l) => [...entries.slice().reverse(), ...l].slice(0, 200));
  };

  const guard = async (fn: () => Promise<any>): Promise<any> => {
    setBusy(true);
    setErr(null);
    try {
      return await fn();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(m);
      pushLog(m, 'ERROR');
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const buy = (serviceId: number) =>
    guard(async () => {
      const res = await api.buy(serviceId);
      logSteps(res.steps);
      if (res.outcome === 'NETWORK_FAILURE') {
        setLastRetry({ requestId: res.requestId, idempotencyKey: res.idempotencyKey });
      }
      await refresh();
      return res;
    });

  const demoRetry = () =>
    guard(async () => {
      const first = await api.buyFail(services[0]?.id ?? 0);
      logSteps(first.steps);
      pushLog(`Attempt 1 charged ${money(first.chargedDollars)} (settled, response lost)`, 'PAID');
      const r = await api.retry(first.requestId, first.idempotencyKey);
      logSteps(r.steps);
      pushLog(`Attempt 2 charged ${money(r.chargedDollars)} — ${r.reason}`, 'NO_SECOND_CHARGE');
      setLastRetry({ requestId: first.requestId, idempotencyKey: first.idempotencyKey });
      await refresh();
    });

  const retryLast = () =>
    guard(async () => {
      if (!lastRetry) {
        pushLog('No pending request to retry — run "Simulate Network Failure" first.', 'INFO');
        return;
      }
      const r = await api.retry(lastRetry.requestId, lastRetry.idempotencyKey);
      logSteps(r.steps);
      await refresh();
    });

  const attack = () =>
    guard(async () => {
      const res = await api.overspend(Number(attackAmount));
      logSteps(res.steps);
      setAttackResult(res);
      await refresh();
      return res;
    });

  const verify = (deliveryId: number) =>
    guard(async () => {
      const res = await api.verify(deliveryId);
      pushLog(`VERA: ${res.vera.verdict} — ${res.vera.observedResult}`, res.deliveryStatus);
      setReceipt(res.receipt);
      await refresh();
    });

  const tamper = (deliveryId: number) =>
    guard(async () => {
      const res = await api.tamper(deliveryId);
      pushLog(`Tampered artifact re-verified: hashValid=${res.verify.hashValid} → ${res.verify.deliveryStatus}`, res.verify.deliveryStatus);
      setReceipt(res.verify.receipt);
      await refresh();
    });

  const viewReceipt = (paymentId: number) =>
    guard(async () => {
      const r = await api.receipt(paymentId);
      setReceipt(r.receipt);
      setTab('verify');
    });

  const reset = () =>
    guard(async () => {
      await api.reset();
      setLastRetry(null);
      setAttackResult(null);
      setReceipt(null);
      setLog([]);
      pushLog('Demo reset — budget restored to $10.00', 'RESET');
      await refresh();
    });

  const policy = dash?.policy ?? null;
  const services = dash?.services ?? [];
  const txns = dash?.transactions ?? [];
  const counts = dash?.counts;
  const util = policy?.utilizationPct ?? 0;

  return (
    <div className="min-h-screen text-pp-ink">
      <header className="border-b border-pp-line bg-pp-panel/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-5 py-3 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-pp-green/15 border border-pp-green/40 flex items-center justify-center font-mono font-bold text-pp-green">PP</div>
            <div>
              <div className="font-bold leading-tight">PayProof <span className="text-pp-mut">×</span> VERA</div>
              <div className="text-[11px] text-pp-mut">Verified Agent Commerce — W3A-1</div>
            </div>
          </div>
          <div className="flex-1" />
          <div className="text-right">
            <div className="text-[11px] text-pp-mut">Owner</div>
            <div className="text-sm font-semibold">{dash?.user.name ?? '—'}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-pp-mut">Agent</div>
            <div className="text-sm font-semibold">{dash?.agent.name ?? '—'}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-pp-mut">Remaining</div>
            <div className="text-sm font-bold text-pp-green">{money(policy?.remainingDollars)}</div>
          </div>
          <button className="btn-ghost" onClick={reset} disabled={busy}>Reset</button>
        </div>
      </header>

      <nav className="max-w-7xl mx-auto px-5 pt-4 flex gap-1 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === t.id ? 'bg-pp-green/15 text-pp-green' : 'text-pp-mut hover:text-pp-ink hover:bg-white/5'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {err && <div className="max-w-7xl mx-auto px-5 mt-3"><div className="panel border-pp-red/40 p-3 text-pp-red text-sm">{err}</div></div>}

      <main className="max-w-7xl mx-auto px-5 py-5 space-y-5">
        {tab === 'overview' && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Hard Budget" value={money(policy?.maxBudgetDollars)} accent="text-pp-ink" />
              <Stat label="Spent" value={money(policy?.spentDollars)} accent="text-pp-amber" />
              <Stat label="Remaining" value={money(policy?.remainingDollars)} accent="text-pp-green" />
              <Stat label="Blocked Attempts" value={String(counts?.blockedAttempts ?? 0)} accent="text-pp-red" />
            </div>

            <div className="panel p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="label">Budget Utilization</div>
                <div className="font-mono text-sm">{util}%</div>
              </div>
              <div className="h-3 rounded-full bg-pp-line overflow-hidden">
                <div className={`h-full ${util >= 100 ? 'bg-pp-red' : util >= 60 ? 'bg-pp-amber' : 'bg-pp-green'}`} style={{ width: `${Math.min(util, 100)}%` }} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
                <Mini label="Settled payments" value={String(counts?.settledPayments ?? 0)} />
                <Mini label="VERA-verified deliveries" value={String(counts?.verifiedDeliveries ?? 0)} />
                <Mini label="Failed verifications" value={String(counts?.failedVerifications ?? 0)} />
                <Mini label="Idempotent / dup blocks" value={String(counts?.duplicateBlocks ?? 0)} />
              </div>
            </div>

            <div className="panel p-5">
              <div className="label mb-3">The Boundary</div>
              <div className="grid md:grid-cols-2 gap-5">
                <div className="border border-pp-line rounded-lg p-4">
                  <div className="font-bold text-pp-green mb-1">PAYPROOF — Financial Authority</div>
                  <p className="text-sm text-pp-mut">"Can this agent spend this money?" Hard cap, policy, idempotency and payment enforcement — all decided server-side, outside the agent's reasoning.</p>
                </div>
                <div className="border border-pp-line rounded-lg p-4">
                  <div className="font-bold text-pp-violet mb-1">VERA — Work Verification</div>
                  <p className="text-sm text-pp-mut">"Did it actually receive valid work?" VERA executes checks against the delivered artifact and compares observed behaviour with the provider's claim.</p>
                </div>
              </div>
            </div>
          </>
        )}

        {tab === 'market' && (
          <div className="grid md:grid-cols-2 gap-4">
            {services.map((s) => (
              <div key={s.id} className="panel p-5 flex flex-col">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-bold">{s.name}</div>
                    <div className="text-[11px] text-pp-mut">{s.providerName}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-pp-green">{money(s.priceDollars)}</div>
                    <div className="text-[10px] font-mono text-pp-violet">VERA: {s.veraMode}</div>
                  </div>
                </div>
                <p className="text-sm text-pp-mut mt-3 flex-1">{s.description}</p>
                <div className="mt-4 flex gap-2">
                  <button className="btn-primary" onClick={() => buy(s.id)} disabled={busy}>Buy via Agent</button>
                  <button
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() =>
                      guard(async () => {
                        const res = await api.buyFail(s.id);
                        logSteps(res.steps);
                        setLastRetry({ requestId: res.requestId, idempotencyKey: res.idempotencyKey });
                        await refresh();
                      })
                    }
                  >
                    Simulate Network Failure
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'attack' && (
          <>
            <div className="panel p-5">
              <div className="label mb-3">Overspend Attack</div>
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <div className="text-[11px] text-pp-mut mb-1">Current remaining</div>
                  <div className="font-mono text-lg text-pp-green">{money(policy?.remainingDollars)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-pp-mut mb-1">Agent attempts to spend ($)</div>
                  <input
                    value={attackAmount}
                    onChange={(e) => setAttackAmount(e.target.value)}
                    className="bg-pp-bg border border-pp-line rounded-lg px-3 py-2 w-32 font-mono"
                  />
                </div>
                <button className="btn-danger" onClick={attack} disabled={busy}>Attempt Overspend</button>
              </div>
              <p className="text-xs text-pp-mut mt-3">The agent is allowed to TRY. The enforcement layer — not the agent — decides.</p>
            </div>

            {attackResult && (
              <div className="panel p-6 border-2 border-pp-red/50 font-mono">
                <div className="text-pp-red font-bold text-lg mb-3">OVERSPEND ATTACK</div>
                <Row k="Requested" v={money(attackResult.requestedDollars)} />
                <Row k="Remaining" v={money(attackResult.remainingDollars)} />
                <div className="my-3 border-t border-pp-line" />
                <div className={`text-xl font-bold ${attackResult.outcome === 'BLOCKED_BUDGET' ? 'text-pp-red' : 'text-pp-green'}`}>
                  RESULT: {attackResult.outcome === 'BLOCKED_BUDGET' ? 'BLOCKED' : attackResult.outcome === 'NOT_AN_OVERSPEND' ? 'ALLOWED (within budget)' : attackResult.outcome}
                </div>
                <div className="mt-2 text-sm">
                  Enforcement: <span className="text-pp-amber">{attackResult.enforcement}</span> · Agent control: <span className="text-pp-red">{attackResult.agentControl}</span>
                </div>
                {attackResult.reason && <div className="mt-1 text-xs text-pp-mut">Reason: {attackResult.reason}</div>}
                <div className="mt-2 text-sm">Charged: {money(attackResult.chargedDollars)}</div>
              </div>
            )}
          </>
        )}

        {tab === 'verify' && (
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="panel p-5">
              <div className="label mb-3">Delivered Artifacts</div>
              {deliveries.length === 0 && <div className="text-sm text-pp-mut">No deliveries yet. Buy a service first.</div>}
              <div className="space-y-3">
                {deliveries.map((d) => (
                  <div key={d.id} className="border border-pp-line rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-sm">{d.service ?? 'Custom'}</div>
                      <Badge s={d.verificationStatus} />
                    </div>
                    <div className="font-mono text-[11px] text-pp-mut mt-1 break-all">{d.contentHash}</div>
                    <div className="flex gap-2 mt-2">
                      <button className="btn-ghost" onClick={() => verify(d.id)} disabled={busy}>Verify Again</button>
                      <button className="btn-danger" onClick={() => tamper(d.id)} disabled={busy}>Tamper</button>
                      <button className="btn-ghost" onClick={() => viewReceipt(d.paymentId)} disabled={busy}>Receipt</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel p-5">
              <div className="label mb-3">Verified Payment Receipt</div>
              {!receipt && <div className="text-sm text-pp-mut">Select a receipt to inspect the combined proof.</div>}
              {receipt && (
                <div className="space-y-4 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="font-bold">{receipt.service ?? 'Custom spend'}</div>
                    <Badge s={receipt.finalStatus} />
                  </div>
                  <Block title="Authorization (PayProof)">
                    <Row k="Budget" v={money(receipt.authorization.budgetDollars)} />
                    <Row k="Spent before" v={money(receipt.authorization.spentBeforeDollars)} />
                    <Row k="Requested" v={money(receipt.authorization.requestedDollars)} />
                    <Row k="Remaining before" v={money(receipt.authorization.remainingBeforeDollars)} />
                    <Row k="Allowed" v={String(receipt.authorization.allowed)} />
                  </Block>
                  <Block title="Payment">
                    <Row k="Status" v={receipt.payment.status} />
                    <Row k="Request" v={receipt.requestId} />
                    <Row k="Idempotency" v={receipt.requestId.replace('req_', 'idem_')} />
                  </Block>
                  <Block title="Delivery">
                    <Row k="Received" v={String(receipt.delivery.received)} />
                    <div className="font-mono text-[11px] text-pp-mut break-all mt-1">{receipt.delivery.artifactHash}</div>
                  </Block>
                  {receipt.verification && (
                    <Block title="VERA — Executable Verification">
                      <Row k="Verifier" v={receipt.verification.verifier} />
                      <Row k="Mode" v={receipt.verification.mode} />
                      <div className="mt-1"><span className="text-pp-mut">Claim: </span>{receipt.verification.claim}</div>
                      <div className="mt-1"><span className="text-pp-mut">Observed: </span>{receipt.verification.observedResult}</div>
                      <div className="mt-1">Verdict: <Badge s={receipt.verification.verdict} /></div>
                    </Block>
                  )}
                  <Block title="Integrity">
                    <Row k="Algorithm" v={receipt.integrity.hashAlgorithm} />
                    <Row k="Hash valid" v={String(receipt.integrity.hashValid)} />
                    <div className="font-mono text-[11px] text-pp-mut break-all mt-1">committed: {receipt.integrity.contentHash}</div>
                    <div className="font-mono text-[11px] text-pp-mut break-all">recomputed: {receipt.integrity.recomputedHash}</div>
                  </Block>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'stream' && (
          <div className="panel p-5 overflow-x-auto">
            <div className="label mb-3">Transaction Stream</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-pp-mut text-left text-[11px] uppercase">
                  <th className="py-2">#</th>
                  <th className="py-2">Time</th>
                  <th className="py-2">Service</th>
                  <th className="py-2">Provider</th>
                  <th className="py-2 text-right">Amount</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Verification</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id} className="border-t border-pp-line">
                    <td className="py-2 font-mono text-pp-mut">{t.id}</td>
                    <td className="py-2 font-mono text-[11px] text-pp-mut">{new Date(t.createdAt).toLocaleTimeString()}</td>
                    <td className="py-2">{t.service}</td>
                    <td className="py-2 text-pp-mut">{t.provider ?? '—'}</td>
                    <td className="py-2 text-right font-mono">{money(t.amountDollars)}</td>
                    <td className="py-2"><Badge s={t.status} /></td>
                    <td className="py-2">{t.verification ? <Badge s={t.verification} /> : <span className="text-pp-mut text-xs">—</span>}</td>
                    <td className="py-2 text-right">
                      <button className="btn-ghost !px-2 !py-1" onClick={() => viewReceipt(t.id)}>Receipt</button>
                    </td>
                  </tr>
                ))}
                {txns.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-pp-mut">No transactions yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'audit' && (
          <div className="panel p-5">
            <div className="label mb-3">Audit Trail</div>
            <div className="space-y-2">
              {events.map((e) => (
                <div key={e.id} className="flex gap-3 text-sm border-b border-pp-line/60 pb-2">
                  <div className="font-mono text-[11px] text-pp-mut w-20 shrink-0">{new Date(e.timestamp).toLocaleTimeString()}</div>
                  <div className="w-48 shrink-0 font-mono text-[11px] text-pp-violet">{e.type}</div>
                  <div className="flex-1">{e.description}</div>
                </div>
              ))}
              {events.length === 0 && <div className="text-sm text-pp-mut">No audit events.</div>}
            </div>
          </div>
        )}

        {tab === 'demo' && (
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="space-y-4">
              <div className="panel p-5">
                <div className="label mb-3">Guided Demo</div>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-primary" onClick={() => services[0] && buy(services[0].id)} disabled={busy || !services[0]}>1 · Buy Service ($2)</button>
                  <button className="btn-ghost" onClick={demoRetry} disabled={busy}>2 · Retry Same Request</button>
                  <button className="btn-danger" onClick={attack} disabled={busy}>3 · Attempt Overspend</button>
                  <button className="btn-violet" onClick={() => deliveries[0] && verify(deliveries[0].id)} disabled={busy || deliveries.length === 0}>4 · Verify Delivery</button>
                  <button className="btn-danger" onClick={() => deliveries[0] && tamper(deliveries[0].id)} disabled={busy || deliveries.length === 0}>5 · Tamper Artifact</button>
                  <button className="btn-ghost" onClick={retryLast} disabled={busy || !lastRetry}>Retry Last Failure</button>
                </div>
                <p className="text-xs text-pp-mut mt-3">Every button calls the real backend. Watch the live console and the audit trail.</p>
              </div>

              <div className="panel p-5">
                <div className="flex items-center justify-between">
                  <div className="label">Budget</div>
                  <div className="font-mono text-sm text-pp-green">{money(policy?.remainingDollars)} left of {money(policy?.maxBudgetDollars)}</div>
                </div>
                <div className="h-3 rounded-full bg-pp-line overflow-hidden mt-2">
                  <div className={`h-full ${util >= 100 ? 'bg-pp-red' : util >= 60 ? 'bg-pp-amber' : 'bg-pp-green'}`} style={{ width: `${Math.min(util, 100)}%` }} />
                </div>
              </div>
            </div>

            <div className="panel p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="label">Live Event Console</div>
                <span className="chip bg-white/10 text-pp-mut">{busy ? 'RUNNING' : 'IDLE'}</span>
              </div>
              <div className="font-mono text-[12px] space-y-1 max-h-[520px] overflow-y-auto">
                {log.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-pp-mut shrink-0">{l.t}</span>
                    <span className={`shrink-0 ${l.kind.includes('BLOCK') || l.kind.includes('FAIL') || l.kind === 'ERROR' ? 'text-pp-red' : l.kind.includes('VERIFIED') || l.kind.includes('NO_SECOND') ? 'text-pp-green' : 'text-pp-amber'}`}>[{l.kind}]</span>
                    <span>{l.text}</span>
                  </div>
                ))}
                {log.length === 0 && <div className="text-pp-mut">Waiting for actions…</div>}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="max-w-7xl mx-auto px-5 pb-10 pt-2 text-[11px] text-pp-mut">
        PayProof protects the money. VERA protects the work. · Local deterministic demo · x402-compatible HTTP 402 flow
      </footer>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="panel p-4">
      <div className="label">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent}`}>{value}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[11px] text-pp-mut">{label}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-pp-mut">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-pp-line rounded-lg p-3">
      <div className="label mb-2">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}