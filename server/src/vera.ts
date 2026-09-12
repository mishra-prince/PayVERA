import { sha256, uid } from './canonical';

/**
 * VERA — Executable Verification for Autonomous Agents.
 * "Don't trust the claim. Execute the proof."
 *
 * A hash proves INTEGRITY (the artifact did not change). VERA goes further:
 * it EXECUTES checks against the delivered artifact and compares the observed
 * result with the provider's claim. Integrity failure refuses execution —
 * tampered code is never run.
 */

export type VeraVerdict = 'CLAIM_VERIFIED' | 'CLAIM_NOT_VERIFIED' | 'EXECUTION_ERROR';

export interface VeraOutcome {
  verifier: 'VERA';
  executionId: string;
  mode: 'EXECUTABLE' | 'INTEGRITY_ONLY';
  claim: string;
  observedResult: string;
  verdict: VeraVerdict;
  evidence: Record<string, unknown>;
}

const EXPECTED_TRANSLATIONS: Record<string, string> = {
  'Hello world': 'Hola mundo',
};

export function runVera(serviceName: string, artifact: any, integrityOk: boolean): VeraOutcome {
  const executionId = uid('vera');

  if (!integrityOk) {
    return {
      verifier: 'VERA',
      executionId,
      mode: 'EXECUTABLE',
      claim: 'artifact matches the commitment hash recorded at payment time',
      observedResult: 'content hash mismatch — execution refused',
      verdict: 'CLAIM_NOT_VERIFIED',
      evidence: {
        reason: 'INTEGRITY_FAILURE',
        policy: 'VERA never executes an artifact whose content hash does not match the payment commitment.',
      },
    };
  }

  try {
    switch (serviceName) {
      case 'AI Translation': {
        const expected = EXPECTED_TRANSLATIONS[artifact?.source] ?? null;
        const claim = `translation of "${artifact?.source}" equals "${expected}"`;
        const observed = String(artifact?.target ?? '');
        return {
          verifier: 'VERA', executionId, mode: 'EXECUTABLE', claim,
          observedResult: `delivered target = "${observed}"`,
          verdict: expected !== null && observed === expected ? 'CLAIM_VERIFIED' : 'CLAIM_NOT_VERIFIED',
          evidence: { source: artifact?.source, expected, observed },
        };
      }
      case 'Compute Job': {
        const dataset: number[] = Array.isArray(artifact?.dataset) ? artifact.dataset : [];
        const recomputed = dataset.reduce((a, b) => a + b, 0);
        const claim = `provider claims sum(${JSON.stringify(dataset)}) = ${artifact?.claimedSum}`;
        return {
          verifier: 'VERA', executionId, mode: 'EXECUTABLE', claim,
          observedResult: `VERA recomputed sum = ${recomputed}`,
          verdict: recomputed === artifact?.claimedSum ? 'CLAIM_VERIFIED' : 'CLAIM_NOT_VERIFIED',
          evidence: { dataset, claimedSum: artifact?.claimedSum, recomputedSum: recomputed },
        };
      }
      case 'Data Storage': {
        const recomputed = sha256(String(artifact?.payload ?? ''));
        const claim = `provider claims checksum ${artifact?.checksum} for stored payload`;
        return {
          verifier: 'VERA', executionId, mode: 'EXECUTABLE', claim,
          observedResult: `VERA recomputed checksum = ${recomputed}`,
          verdict: recomputed === artifact?.checksum ? 'CLAIM_VERIFIED' : 'CLAIM_NOT_VERIFIED',
          evidence: { claimedChecksum: artifact?.checksum, recomputedChecksum: recomputed },
        };
      }
      case 'Premium Code Audit': {
        // Provider claims the delivered function is vulnerable. VERA EXECUTES
        // the delivered code against a test vector and observes actual behavior.
        const claim = String(artifact?.claim ?? 'no claim provided');
        const source = String(artifact?.source ?? '');
        const fn = new Function(`"use strict"; return (${source});`)() as (x: number) => unknown;
        const observed = fn(-5);
        const claimSaysReturnsNegative5 = /clamp\(-5\)\s+returns\s+-5/.test(claim);
        const matches = observed === -5;
        const verdict: VeraVerdict = claimSaysReturnsNegative5 === matches ? 'CLAIM_VERIFIED' : 'CLAIM_NOT_VERIFIED';
        return {
          verifier: 'VERA', executionId, mode: 'EXECUTABLE', claim,
          observedResult: `executed clamp(-5) -> ${JSON.stringify(observed)}`,
          verdict,
          evidence: {
            testVector: 'clamp(-5)',
            expectedPerClaim: -5,
            observed,
            note: matches
              ? 'Transaction did NOT revert; lower bound is not enforced. Vulnerability exists as claimed.'
              : 'Observed behavior does not match the provider claim.',
          },
        };
      }
      default:
        return {
          verifier: 'VERA', executionId, mode: 'INTEGRITY_ONLY',
          claim: 'artifact delivered unchanged',
          observedResult: 'content hash valid',
          verdict: 'CLAIM_VERIFIED',
          evidence: { note: 'No executable check registered for this service; integrity only.' },
        };
    }
  } catch (err) {
    return {
      verifier: 'VERA', executionId, mode: 'EXECUTABLE',
      claim: 'executable verification of delivered artifact',
      observedResult: `execution failed: ${(err as Error).message}`,
      verdict: 'EXECUTION_ERROR',
      evidence: { error: (err as Error).message },
    };
  }
}