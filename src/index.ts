import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { DnsDiscovery, StaticDiscovery } from './discovery/dns.js';
import type { Discovery, Peer } from './discovery/types.js';
import type { MapLikeStore } from './store/types.js';
import { Coordinator, type CoordinatorEvents } from './sync/coordinator.js';
import { consoleLogger, type Logger, noopLogger } from './util/logger.js';

export type DiscoveryConfig =
  | {
      type: 'dns';
      /** Headless Service DNS name. */
      host: string;
      /** Poll interval in ms. Default 5_000. */
      intervalMs?: number;
      /** Override self-IP detection. */
      selfIp?: string;
    }
  | {
      type: 'static';
      peers: Peer[];
    }
  | {
      type: 'custom';
      discovery: Discovery;
    };

export type CacheSyncOptions<V> = {
  /** Your existing cache store (lru-cache, node-cache, Map, ...). */
  store: MapLikeStore<V>;
  /** Logical cache name. All peers in the same cluster must share it. */
  namespace: string;
  /** Shared HMAC secret for peer-to-peer requests. */
  auth: { hmacSecret: string };
  /** Peer discovery configuration. */
  discovery: DiscoveryConfig;
  /** Port the sync HTTP server listens on. Default 7073. */
  port?: number;
  /** Bind host. Default '0.0.0.0'. */
  host?: string;
  /** Stable per-process id (used as HLC tiebreaker). Default: hostname + random. */
  nodeId?: string;
  /**
   * How long tombstones survive. Default 5 minutes.
   *
   * Must exceed the longest expected peer partition duration: if a peer is
   * isolated for longer than this and then rejoins, its older `set` for a
   * deleted key can resurrect the value locally because the tombstone has
   * been GC'd.
   */
  tombstoneTtlMs?: number;
  /** Bootstrap (snapshot pull) timeout. Default 10_000. */
  bootstrapTimeoutMs?: number;
  /** Per-request timeout for peer broadcasts. Default 2_000. */
  requestTimeoutMs?: number;
  /** Per-peer outbox capacity before oldest-drop. Default 1_000. */
  outboxCapacity?: number;
  /** 'console' | 'silent' | your own Logger. Default 'silent'. */
  logger?: 'console' | 'silent' | Logger;
  /** Optional transport tuning. */
  transport?: {
    /** Payload compression. Snapshots default to gzip; per-op compression deferred. */
    compression?: {
      /** Snapshot stream encoding. Default 'gzip'. Set false to send raw NDJSON. */
      snapshot?: 'gzip' | false;
    };
    /** undici connection pool size per peer. Default 8. */
    maxConnectionsPerPeer?: number;
    /** undici pipelining depth — concurrent in-flight requests per connection. Default 1. */
    pipelining?: number;
  };
};

export type CacheSync<V> = {
  start(): Promise<void>;
  stop(): Promise<void>;
  get(key: string): V | undefined;
  has(key: string): boolean;
  set(key: string, value: V): void;
  delete(key: string): void;
  clear(): void;
  peers(): Peer[];
  on<K extends keyof CoordinatorEvents<V>>(event: K, listener: CoordinatorEvents<V>[K]): void;
  off<K extends keyof CoordinatorEvents<V>>(event: K, listener: CoordinatorEvents<V>[K]): void;
};

export function createCacheSync<V = unknown>(opts: CacheSyncOptions<V>): CacheSync<V> {
  if (!opts.auth?.hmacSecret) {
    throw new Error('cache-mesh: auth.hmacSecret is required');
  }
  if (!opts.namespace) {
    throw new Error('cache-mesh: namespace is required');
  }
  if (
    opts.outboxCapacity !== undefined &&
    (!Number.isInteger(opts.outboxCapacity) || opts.outboxCapacity < 1)
  ) {
    throw new Error('cache-mesh: outboxCapacity must be a positive integer');
  }

  const port = opts.port ?? 7073;
  const nodeId = opts.nodeId ?? `${hostname()}-${randomBytes(4).toString('hex')}`;
  const logger = resolveLogger(opts.logger);

  const discovery = buildDiscovery(opts.discovery, port, logger);

  const coord = new Coordinator<V>({
    nodeId,
    namespace: opts.namespace,
    hmacSecret: opts.auth.hmacSecret,
    store: opts.store,
    discovery,
    port,
    host: opts.host,
    bootstrapTimeoutMs: opts.bootstrapTimeoutMs,
    tombstoneTtlMs: opts.tombstoneTtlMs,
    requestTimeoutMs: opts.requestTimeoutMs,
    outboxCapacity: opts.outboxCapacity,
    snapshotCompression: opts.transport?.compression?.snapshot,
    maxConnectionsPerPeer: opts.transport?.maxConnectionsPerPeer,
    pipelining: opts.transport?.pipelining,
    logger,
  });

  return {
    start: () => coord.start(),
    stop: () => coord.stop(),
    get: (k) => coord.get(k),
    has: (k) => coord.has(k),
    set: (k, v) => coord.set(k, v),
    delete: (k) => coord.delete(k),
    clear: () => coord.clear(),
    peers: () => coord.peers(),
    on: (event, listener) => {
      coord.on(event as string, listener as (...args: unknown[]) => void);
    },
    off: (event, listener) => {
      coord.off(event as string, listener as (...args: unknown[]) => void);
    },
  };
}

function buildDiscovery(cfg: DiscoveryConfig, port: number, logger: Logger): Discovery {
  if (cfg.type === 'dns') {
    return new DnsDiscovery({
      host: cfg.host,
      port,
      intervalMs: cfg.intervalMs,
      selfIp: cfg.selfIp,
      logger,
    });
  }
  if (cfg.type === 'static') {
    return new StaticDiscovery({ peers: cfg.peers });
  }
  return cfg.discovery;
}

function resolveLogger(l: CacheSyncOptions<unknown>['logger']): Logger {
  if (!l || l === 'silent') return noopLogger;
  if (l === 'console') return consoleLogger();
  return l;
}

export type { Peer } from './discovery/types.js';
export type { HLC } from './hlc.js';
export type { MapLikeStore, Op } from './store/types.js';
export type { Logger } from './util/logger.js';
export { getOrCreate as getOrCreateSingleton } from './util/singleton.js';
