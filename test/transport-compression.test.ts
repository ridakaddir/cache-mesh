import { createServer } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { request } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CacheSync, createCacheSync, type Peer } from '../src/index.js';
import { NS_HEADER, SIG_HEADER, sign, TS_HEADER } from '../src/transport/auth.js';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (typeof addr === 'object' && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error('no address'));
      }
    });
  });
}

const SECRET = 'compression-secret';
const NS = 'compression';

type Built = { port: number; cache: CacheSync<unknown> };

async function buildNode(opts: {
  peers?: Peer[];
  snapshotCompression?: 'gzip' | false;
}): Promise<Built> {
  const port = await getFreePort();
  const cache = createCacheSync({
    store: new Map<string, unknown>(),
    namespace: NS,
    auth: { hmacSecret: SECRET },
    discovery: { type: 'static', peers: opts.peers ?? [] },
    port,
    host: '127.0.0.1',
    nodeId: `node-${port}`,
    bootstrapTimeoutMs: 500,
    requestTimeoutMs: 1_000,
    transport:
      opts.snapshotCompression === undefined
        ? undefined
        : { compression: { snapshot: opts.snapshotCompression } },
  });
  await cache.start();
  return { port, cache };
}

async function fetchSnapshot(
  port: number,
  acceptEncoding: string | null,
): Promise<{ status: number; encoding: string | null; body: Buffer }> {
  const path = '/sync/snapshot';
  const ts = Date.now();
  const sig = sign(SECRET, { ts, method: 'GET', path, body: '' });
  const headers: Record<string, string> = {
    [NS_HEADER]: NS,
    [TS_HEADER]: String(ts),
    [SIG_HEADER]: sig,
  };
  if (acceptEncoding !== null) headers['accept-encoding'] = acceptEncoding;

  // undici's `request` (unlike `fetch`) does not auto-add Accept-Encoding
  // and does not auto-decompress — exactly what these tests need to inspect.
  const res = await request(`http://127.0.0.1:${port}${path}`, { method: 'GET', headers });
  const chunks: Buffer[] = [];
  for await (const c of res.body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const enc = res.headers['content-encoding'];
  const encoding = Array.isArray(enc) ? (enc[0] ?? null) : (enc ?? null);
  return { status: res.statusCode, encoding, body: Buffer.concat(chunks) };
}

describe('snapshot compression', () => {
  let nodes: Built[] = [];

  beforeEach(() => {
    nodes = [];
  });

  afterEach(async () => {
    await Promise.all(nodes.map((n) => n.cache.stop()));
    nodes = [];
  });

  it('gzips the snapshot when client sends Accept-Encoding: gzip (default config)', async () => {
    const node = await buildNode({});
    nodes.push(node);
    node.cache.set('alpha', { v: 'a' });
    node.cache.set('beta', { v: 'b' });

    const got = await fetchSnapshot(node.port, 'gzip');
    expect(got.status).toBe(200);
    expect(got.encoding).toBe('gzip');

    // Body must be valid gzip and decompress to NDJSON containing both keys.
    const ndjson = gunzipSync(got.body).toString('utf8');
    const lines = ndjson.split('\n').filter((l) => l.length > 0);
    const keys = lines.map((l) => JSON.parse(l).key as string).sort();
    expect(keys).toEqual(['alpha', 'beta']);
  });

  it('returns raw NDJSON when client omits Accept-Encoding', async () => {
    const node = await buildNode({});
    nodes.push(node);
    node.cache.set('only', 'value');

    const got = await fetchSnapshot(node.port, null);
    expect(got.status).toBe(200);
    expect(got.encoding).toBeNull();
    const lines = got.body
      .toString('utf8')
      .split('\n')
      .filter((l) => l.length > 0);
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]!).key).toBe('only');
  });

  it('returns raw NDJSON when snapshot compression is disabled, even if client asks', async () => {
    const node = await buildNode({ snapshotCompression: false });
    nodes.push(node);
    node.cache.set('only', 'value');

    const got = await fetchSnapshot(node.port, 'gzip');
    expect(got.status).toBe(200);
    expect(got.encoding).toBeNull();
    expect(got.body.toString('utf8')).toContain('"key":"only"');
  });

  it('bootstraps a late joiner end-to-end with gzip on the wire', async () => {
    const seed = await buildNode({});
    nodes.push(seed);
    seed.cache.set('k1', 'v1');
    seed.cache.set('k2', 'v2');

    const joiner = await buildNode({
      peers: [{ id: `127.0.0.1:${seed.port}`, host: '127.0.0.1', port: seed.port }],
    });
    nodes.push(joiner);

    expect(joiner.cache.get('k1')).toBe('v1');
    expect(joiner.cache.get('k2')).toBe('v2');
  });

  it('bootstraps a late joiner end-to-end with compression disabled', async () => {
    const seed = await buildNode({ snapshotCompression: false });
    nodes.push(seed);
    seed.cache.set('alpha', 1);
    seed.cache.set('beta', 2);

    const joiner = await buildNode({
      snapshotCompression: false,
      peers: [{ id: `127.0.0.1:${seed.port}`, host: '127.0.0.1', port: seed.port }],
    });
    nodes.push(joiner);

    expect(joiner.cache.get('alpha')).toBe(1);
    expect(joiner.cache.get('beta')).toBe(2);
  });
});

describe('transport tuning knobs', () => {
  let nodes: Built[] = [];

  beforeEach(() => {
    nodes = [];
  });

  afterEach(async () => {
    await Promise.all(nodes.map((n) => n.cache.stop()));
    nodes = [];
  });

  it('accepts pipelining and maxConnectionsPerPeer and still replicates', async () => {
    const seedPort = await getFreePort();
    const joinerPort = await getFreePort();
    const peers = (self: number): Peer[] =>
      [seedPort, joinerPort]
        .filter((p) => p !== self)
        .map((p) => ({ id: `127.0.0.1:${p}`, host: '127.0.0.1', port: p }));

    const make = (port: number) =>
      createCacheSync({
        store: new Map<string, unknown>(),
        namespace: NS,
        auth: { hmacSecret: SECRET },
        discovery: { type: 'static', peers: peers(port) },
        port,
        host: '127.0.0.1',
        nodeId: `tune-${port}`,
        bootstrapTimeoutMs: 500,
        requestTimeoutMs: 1_000,
        transport: { pipelining: 4, maxConnectionsPerPeer: 2 },
      });

    const seed = make(seedPort);
    const joiner = make(joinerPort);
    nodes.push({ port: seedPort, cache: seed }, { port: joinerPort, cache: joiner });
    await Promise.all([seed.start(), joiner.start()]);

    seed.set('tuned', 'yes');
    const start = Date.now();
    while (joiner.get('tuned') !== 'yes') {
      if (Date.now() - start > 2_000) throw new Error('replication timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(joiner.get('tuned')).toBe('yes');
  });
});
