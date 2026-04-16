import { createHmac, timingSafeEqual } from 'node:crypto';

export const TS_HEADER = 'x-cachesync-ts';
export const SIG_HEADER = 'x-cachesync-sig';
export const NS_HEADER = 'x-cachesync-ns';

const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;

export function sign(
  secret: string,
  parts: { ts: number; method: string; path: string; body: string },
): string {
  const h = createHmac('sha256', secret);
  h.update(String(parts.ts));
  h.update('\n');
  h.update(parts.method.toUpperCase());
  h.update('\n');
  h.update(parts.path);
  h.update('\n');
  h.update(parts.body);
  return h.digest('hex');
}

export type VerifyInput = {
  secret: string;
  ts: string | undefined;
  sig: string | undefined;
  method: string;
  path: string;
  body: string;
  now?: number;
  maxSkewMs?: number;
};

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'missing-headers' | 'bad-timestamp' | 'skew' | 'bad-signature' };

export function verify(input: VerifyInput): VerifyResult {
  if (!input.ts || !input.sig) return { ok: false, reason: 'missing-headers' };
  const ts = Number(input.ts);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad-timestamp' };

  const now = input.now ?? Date.now();
  const maxSkew = input.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
  if (Math.abs(now - ts) > maxSkew) return { ok: false, reason: 'skew' };

  const expected = sign(input.secret, {
    ts,
    method: input.method,
    path: input.path,
    body: input.body,
  });

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(input.sig, 'hex');
  if (a.length !== b.length) return { ok: false, reason: 'bad-signature' };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: 'bad-signature' };
  return { ok: true };
}
