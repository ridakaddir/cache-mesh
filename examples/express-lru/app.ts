import { createCacheSync } from 'cache-mesh';
import express from 'express';
import { LRUCache } from 'lru-cache';

const store = new LRUCache<string, unknown>({ max: 10_000 });

const cache = createCacheSync({
  store,
  namespace: 'express-demo',
  auth: { hmacSecret: process.env.CACHE_SYNC_KEY ?? 'dev-secret' },
  discovery: {
    type: 'dns',
    host: process.env.CACHE_SYNC_HOST ?? 'my-app-sync.default.svc.cluster.local',
  },
  port: Number(process.env.CACHE_SYNC_PORT ?? 7073),
  logger: 'console',
});

await cache.start();

const app = express();
app.use(express.json());

app.get('/cache/:key', (req, res) => {
  const v = cache.get(req.params.key);
  if (v === undefined) return res.status(404).end();
  res.json({ key: req.params.key, value: v });
});

app.put('/cache/:key', (req, res) => {
  cache.set(req.params.key, req.body);
  res.status(204).end();
});

app.delete('/cache/:key', (req, res) => {
  cache.delete(req.params.key);
  res.status(204).end();
});

const server = app.listen(Number(process.env.PORT ?? 3000), () => {
  console.log(`listening on :${process.env.PORT ?? 3000}`);
});

async function shutdown() {
  server.close();
  await cache.stop();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
