import { createServer } from 'node:http';
import { LRUCache } from 'lru-cache';
import { createCacheSync } from './dist/index.js';

const NODE_NAME = process.env.NODE_NAME ?? 'unknown';
const PORT = Number(process.env.PORT ?? 3000);
const SYNC_PORT = Number(process.env.CACHE_MESH_PORT ?? 7073);
const PEERS_CSV = process.env.PEERS ?? ''; // "host1:port,host2:port"

const store = new LRUCache({ max: 10_000 });

const peers = PEERS_CSV
  ? PEERS_CSV.split(',').map((hp) => {
      const [host, port] = hp.split(':');
      return { id: `${host}:${port}`, host, port: Number(port) };
    })
  : [];

console.log(`[${NODE_NAME}] starting with peers: ${JSON.stringify(peers)}`);

const cache = createCacheSync({
  store,
  namespace: 'demo',
  auth: { hmacSecret: process.env.CACHE_MESH_KEY ?? 'demo-secret' },
  discovery: { type: 'static', peers },
  port: SYNC_PORT,
  host: '0.0.0.0',
  nodeId: NODE_NAME,
  logger: 'console',
});

await cache.start();
console.log(`[${NODE_NAME}] cache-mesh started on :${SYNC_PORT}`);

function readBody(req) {
  return new Promise((resolve) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
  });
}

const app = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const key = url.pathname.replace(/^\/cache\//, '');

  if (req.method === 'GET' && url.pathname === '/peers') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ node: NODE_NAME, peers: cache.peers() }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/dump') {
    const entries = {};
    for (const [k, v] of store.entries()) entries[k] = v;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ node: NODE_NAME, entries }));
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/cache/')) {
    const v = cache.get(key);
    if (v === undefined) {
      res.statusCode = 404;
      res.end(JSON.stringify({ node: NODE_NAME, key, found: false }));
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ node: NODE_NAME, key, value: v }));
    return;
  }

  if (req.method === 'PUT' && url.pathname.startsWith('/cache/')) {
    const body = await readBody(req);
    const value = body ? JSON.parse(body) : null;
    cache.set(key, value);
    res.statusCode = 201;
    res.end(JSON.stringify({ node: NODE_NAME, key, stored: true }));
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/cache/')) {
    cache.delete(key);
    res.statusCode = 200;
    res.end(JSON.stringify({ node: NODE_NAME, key, deleted: true }));
    return;
  }

  res.statusCode = 404;
  res.end('not found');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${NODE_NAME}] HTTP API on :${PORT}`);
});

process.on('SIGTERM', async () => {
  app.close();
  await cache.stop();
  process.exit(0);
});
