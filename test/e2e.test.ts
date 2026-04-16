import { createServer } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CacheSync, createCacheSync, type Peer } from '../src/index.js';

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

type Node = {
  port: number;
  cache: CacheSync<unknown>;
  store: Map<string, unknown>;
};

const SECRET = 'e2e-secret';
const NS = 'e2e';

async function makeNode(nodes: Node[]): Promise<Node> {
  const port = await getFreePort();
  const store = new Map<string, unknown>();
  const peers: Peer[] = nodes.map((n) => ({
    id: `127.0.0.1:${n.port}`,
    host: '127.0.0.1',
    port: n.port,
  }));
  const cache = createCacheSync({
    store,
    namespace: NS,
    auth: { hmacSecret: SECRET },
    discovery: { type: 'static', peers },
    port,
    host: '127.0.0.1',
    nodeId: `node-${port}`,
    bootstrapTimeoutMs: 1_500,
    requestTimeoutMs: 1_000,
  });
  return { port, cache, store };
}

async function waitFor(cond: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('cache-mesh e2e', () => {
  let nodes: Node[] = [];

  beforeEach(() => {
    nodes = [];
  });

  afterEach(async () => {
    await Promise.all(nodes.map((n) => n.cache.stop()));
    nodes = [];
  });

  it('replicates writes to every peer', async () => {
    const a = await makeNode([]);
    nodes.push(a);
    const b = await makeNode([a]);
    nodes.push(b);
    const c = await makeNode([a, b]);
    nodes.push(c);

    // Rebuild a and b with full peer lists so all three see each other.
    await Promise.all(nodes.map((n) => n.cache.stop()));
    nodes = [];
    const ports = await Promise.all([getFreePort(), getFreePort(), getFreePort()]);
    const peersFor = (self: number): Peer[] =>
      ports
        .filter((p) => p !== self)
        .map((p) => ({ id: `127.0.0.1:${p}`, host: '127.0.0.1', port: p }));

    const built: Node[] = ports.map((port) => {
      const store = new Map<string, unknown>();
      const cache = createCacheSync({
        store,
        namespace: NS,
        auth: { hmacSecret: SECRET },
        discovery: { type: 'static', peers: peersFor(port) },
        port,
        host: '127.0.0.1',
        nodeId: `node-${port}`,
        bootstrapTimeoutMs: 1_000,
        requestTimeoutMs: 1_000,
      });
      return { port, cache, store };
    });
    nodes = built;
    await Promise.all(built.map((n) => n.cache.start()));

    built[0]!.cache.set('hello', 'world');

    await waitFor(
      () => built[1]!.cache.get('hello') === 'world' && built[2]!.cache.get('hello') === 'world',
    );

    expect(built[1]!.cache.get('hello')).toBe('world');
    expect(built[2]!.cache.get('hello')).toBe('world');
  });

  it('converges on concurrent writes to the same key', async () => {
    const ports = await Promise.all([getFreePort(), getFreePort()]);
    const peersFor = (self: number): Peer[] =>
      ports
        .filter((p) => p !== self)
        .map((p) => ({ id: `127.0.0.1:${p}`, host: '127.0.0.1', port: p }));

    const built: Node[] = ports.map((port) => {
      const store = new Map<string, unknown>();
      return {
        port,
        store,
        cache: createCacheSync({
          store,
          namespace: NS,
          auth: { hmacSecret: SECRET },
          discovery: { type: 'static', peers: peersFor(port) },
          port,
          host: '127.0.0.1',
          nodeId: `node-${port}`,
          bootstrapTimeoutMs: 500,
          requestTimeoutMs: 1_000,
        }),
      };
    });
    nodes = built;
    await Promise.all(built.map((n) => n.cache.start()));

    built[0]!.cache.set('k', 'from-0');
    built[1]!.cache.set('k', 'from-1');

    await waitFor(() => built[0]!.cache.get('k') === built[1]!.cache.get('k'));
    expect(built[0]!.cache.get('k')).toBe(built[1]!.cache.get('k'));
  });

  it('bootstraps a late joiner from an existing peer', async () => {
    const aPort = await getFreePort();
    const bPort = await getFreePort();

    const aStore = new Map<string, unknown>();
    const a = createCacheSync({
      store: aStore,
      namespace: NS,
      auth: { hmacSecret: SECRET },
      discovery: {
        type: 'static',
        peers: [{ id: `127.0.0.1:${bPort}`, host: '127.0.0.1', port: bPort }],
      },
      port: aPort,
      host: '127.0.0.1',
      nodeId: `node-${aPort}`,
      bootstrapTimeoutMs: 300,
      requestTimeoutMs: 500,
    });
    nodes.push({ port: aPort, store: aStore, cache: a });
    await a.start();

    a.set('k1', 'v1');
    a.set('k2', 'v2');

    const bStore = new Map<string, unknown>();
    const b = createCacheSync({
      store: bStore,
      namespace: NS,
      auth: { hmacSecret: SECRET },
      discovery: {
        type: 'static',
        peers: [{ id: `127.0.0.1:${aPort}`, host: '127.0.0.1', port: aPort }],
      },
      port: bPort,
      host: '127.0.0.1',
      nodeId: `node-${bPort}`,
      bootstrapTimeoutMs: 2_000,
      requestTimeoutMs: 1_000,
    });
    nodes.push({ port: bPort, store: bStore, cache: b });
    await b.start();

    expect(b.get('k1')).toBe('v1');
    expect(b.get('k2')).toBe('v2');
  });

  it('propagates deletes and honors tombstones', async () => {
    const ports = await Promise.all([getFreePort(), getFreePort()]);
    const peersFor = (self: number): Peer[] =>
      ports
        .filter((p) => p !== self)
        .map((p) => ({ id: `127.0.0.1:${p}`, host: '127.0.0.1', port: p }));

    const built: Node[] = ports.map((port) => {
      const store = new Map<string, unknown>();
      return {
        port,
        store,
        cache: createCacheSync({
          store,
          namespace: NS,
          auth: { hmacSecret: SECRET },
          discovery: { type: 'static', peers: peersFor(port) },
          port,
          host: '127.0.0.1',
          nodeId: `node-${port}`,
          bootstrapTimeoutMs: 500,
          requestTimeoutMs: 1_000,
        }),
      };
    });
    nodes = built;
    await Promise.all(built.map((n) => n.cache.start()));

    built[0]!.cache.set('k', 'v');
    await waitFor(() => built[1]!.cache.get('k') === 'v');

    built[0]!.cache.delete('k');
    await waitFor(() => !built[1]!.cache.has('k'));
    expect(built[1]!.cache.get('k')).toBeUndefined();
  });
});
