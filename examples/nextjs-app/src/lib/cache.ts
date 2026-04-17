import { type CacheSync, createCacheSync } from 'cache-mesh';
import { getOrCreate } from 'cache-mesh/singleton';
import { LRUCache } from 'lru-cache';

type Product = { id: string; name: string; price: number };

/**
 * Accessed from route handlers. The `getOrCreate` helper keys on
 * `globalThis`, so the coordinator survives Next.js HMR and is shared across
 * app/pages route module graphs.
 */
export const getCache = (): CacheSync<Product> =>
  getOrCreate('product-cache', () =>
    createCacheSync<Product>({
      store: new LRUCache<string, Product>({ max: 10_000 }),
      namespace: 'product-cache',
      auth: { hmacSecret: process.env.CACHE_MESH_KEY ?? 'dev-secret' },
      discovery: {
        type: 'dns',
        host: process.env.CACHE_MESH_HOST ?? 'my-app-sync.default.svc.cluster.local',
      },
      port: Number(process.env.CACHE_MESH_PORT ?? 7073),
      logger: process.env.NODE_ENV === 'production' ? 'silent' : 'console',
    }),
  );
