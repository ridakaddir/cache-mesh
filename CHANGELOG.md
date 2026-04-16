# cache-mesh

## 0.2.0

### Minor Changes

- [`a5bdece`](https://github.com/ridakaddir/cache-mesh/commit/a5bdece6f4eede451483878412770bb0cacc3a82) Thanks [@ridakaddir](https://github.com/ridakaddir)! - Initial release of cache-mesh — peer-to-peer in-memory cache replication for Node.js on Kubernetes.

  - Full replication across pods via HTTP
  - Headless Service DNS peer discovery (zero RBAC)
  - Hybrid Logical Clock for last-write-wins conflict resolution
  - Snapshot bootstrap for late-joining pods
  - HMAC-SHA256 signed peer-to-peer requests
  - Wraps any Map-like store (lru-cache, node-cache, Map, etc.)
  - globalThis singleton for Next.js HMR safety
