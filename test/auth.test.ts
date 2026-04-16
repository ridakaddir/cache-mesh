import { describe, expect, it } from 'vitest';
import { sign, verify } from '../src/transport/auth.js';

describe('HMAC auth', () => {
  const secret = 'super-secret';
  const base = { method: 'POST', path: '/sync/op', body: '{"k":1}' };

  it('verifies a freshly signed request', () => {
    const ts = Date.now();
    const s = sign(secret, { ts, ...base });
    const res = verify({ secret, ts: String(ts), sig: s, ...base });
    expect(res).toEqual({ ok: true });
  });

  it('rejects missing headers', () => {
    const res = verify({ secret, ts: undefined, sig: undefined, ...base });
    expect(res).toEqual({ ok: false, reason: 'missing-headers' });
  });

  it('rejects stale timestamp', () => {
    const ts = Date.now() - 10 * 60 * 1000;
    const s = sign(secret, { ts, ...base });
    const res = verify({ secret, ts: String(ts), sig: s, ...base });
    expect(res.ok).toBe(false);
  });

  it('rejects tampered body', () => {
    const ts = Date.now();
    const s = sign(secret, { ts, ...base });
    const res = verify({ secret, ts: String(ts), sig: s, ...base, body: '{"k":2}' });
    expect(res).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects bad secret', () => {
    const ts = Date.now();
    const s = sign('other-secret', { ts, ...base });
    const res = verify({ secret, ts: String(ts), sig: s, ...base });
    expect(res).toEqual({ ok: false, reason: 'bad-signature' });
  });
});
