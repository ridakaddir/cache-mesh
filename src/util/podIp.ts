import { networkInterfaces } from 'node:os';

/**
 * Best-effort self-IP detection. In k8s, the downward API usually sets
 * POD_IP; fall back to the first non-internal IPv4 address otherwise.
 */
export function detectSelfIp(envVar = 'POD_IP'): string | undefined {
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();

  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const addr of list) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return undefined;
}
