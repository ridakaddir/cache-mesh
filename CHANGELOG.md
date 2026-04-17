# cache-mesh

## 0.2.1

### Patch Changes

- [`77eb949`](https://github.com/ridakaddir/cache-mesh/commit/77eb9497086029b2fae192fc4a012e7362b57eaf) Thanks [@ridakaddir](https://github.com/ridakaddir)! - Ship the code review fixes landed in [#2](https://github.com/ridakaddir/cache-mesh/issues/2).

  Correctness & availability:

  - `StoreWrapper.get()` / `has()` are now O(1) when no tombstone has expired; previously every read scanned the full meta Map.
  - `/sync/snapshot` honours HTTP backpressure, avoiding buffer blow-up on large caches with slow peers.
  - Unhandled `emit('error')` on the Coordinator no longer crashes the host process.
  - NDJSON parser rejects lines above 4 MiB and surfaces malformed JSON via a typed `NdjsonParseError`.
  - `bootstrap:finished` now carries `outcome: 'ok' | 'empty-cluster' | 'all-failed'` so callers can tell success from silent failure.

  Robustness:

  - Per-peer outbox rewritten as a circular buffer with a `droppedCount()` signal; SyncClient logs drops.
  - `coordinator.start()` rolls back partially-started resources on failure.
  - Discovery listeners are detached on `stop()` to prevent leaks across restarts.
  - Remote ops whose HLC physical time is > 5 minutes ahead of local wall clock are rejected, preventing clock-poisoning.
  - `tombstoneTtlMs` JSDoc documents the partition-duration constraint.

  Polish:

  - Environment variable convention unified to `CACHE_MESH_*` across README and examples (`CACHE_SYNC_*` removed). Wire headers (`x-cachesync-*`) unchanged for on-wire compatibility.
  - `outboxCapacity` validated as a positive integer.
  - `onOp` failures return 500 so peers requeue instead of treating a broken apply as delivered.

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
