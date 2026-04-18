---
"cache-mesh": minor
---

Add `transport` config block for snapshot compression and undici dispatcher tuning.

- **Snapshot gzip (default on).** `/sync/snapshot` is now gzip-encoded when the requesting peer sends `Accept-Encoding: gzip` (the bundled client always does). Cuts bootstrap bytes-on-wire ~3× for typical caches. Old peers that ignore the header still receive raw NDJSON, so mixed-version clusters work without coordination. Disable with `transport.compression.snapshot: false`.
- **Pipelining and pool size exposed.** `transport.pipelining` and `transport.maxConnectionsPerPeer` are now overridable from `createCacheSync`. Defaults unchanged (1 / 8) — no behavior change for existing users.
- HMAC envelope unchanged. Server backpressure preserved through the gzip stream.
