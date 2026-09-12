import { createHash, randomUUID } from 'node:crypto';

/** Canonical JSON: object keys sorted recursively, stable serialization. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/** Commitment hash for a delivered artifact: sha256 over canonical JSON. */
export function hashArtifact(value: unknown): string {
  return 'sha256:' + sha256(canonicalize(value));
}

export function uid(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}