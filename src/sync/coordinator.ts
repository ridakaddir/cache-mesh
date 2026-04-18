import { EventEmitter } from 'node:events';
import type { Discovery, Peer } from '../discovery/types.js';
import { type Clock, createClock } from '../hlc.js';
import type { MapLikeStore, Op } from '../store/types.js';
import { StoreWrapper } from '../store/wrapper.js';
import { SyncClient } from '../transport/client.js';
import { SyncServer } from '../transport/server.js';
import { type Logger, noopLogger } from '../util/logger.js';

export type CoordinatorOptions<V> = {
  nodeId: string;
  namespace: string;
  hmacSecret: string;
  store: MapLikeStore<V>;
  discovery: Discovery;
  port: number;
  host?: string;
  bootstrapTimeoutMs?: number;
  tombstoneTtlMs?: number;
  requestTimeoutMs?: number;
  outboxCapacity?: number;
  snapshotCompression?: 'gzip' | false;
  maxConnectionsPerPeer?: number;
  pipelining?: number;
  logger?: Logger;
};

export type BootstrapOutcome = 'ok' | 'empty-cluster' | 'all-failed';

export type CoordinatorEvents<V> = {
  ready: () => void;
  'sync:applied': (op: Op<V>) => void;
  'sync:rejected': (op: Op<V>) => void;
  'peer:add': (peer: Peer) => void;
  'peer:remove': (peer: Peer) => void;
  'bootstrap:started': (peer: Peer) => void;
  'bootstrap:finished': (summary: {
    from: Peer | null;
    applied: number;
    outcome: BootstrapOutcome;
  }) => void;
  error: (err: unknown) => void;
};

const DEFAULT_BOOTSTRAP_TIMEOUT = 10_000;
const MAX_HLC_SKEW_MS = 5 * 60 * 1000;

export class Coordinator<V> extends EventEmitter {
  readonly wrapper: StoreWrapper<V>;
  private readonly clock: Clock;
  private readonly server: SyncServer<V>;
  private readonly client: SyncClient<V>;
  private readonly discovery: Discovery;
  private readonly logger: Logger;
  private readonly bootstrapTimeoutMs: number;
  private started = false;
  private readonly onPeerAdd: (peer: Peer) => void;
  private readonly onPeerRemove: (peer: Peer) => void;
  private readonly onDiscoveryError: (err: unknown) => void;

  constructor(private readonly opts: CoordinatorOptions<V>) {
    super();
    this.logger = opts.logger ?? noopLogger;
    this.clock = createClock(opts.nodeId);
    this.wrapper = new StoreWrapper<V>(opts.store, { tombstoneTtlMs: opts.tombstoneTtlMs });
    this.discovery = opts.discovery;
    this.bootstrapTimeoutMs = opts.bootstrapTimeoutMs ?? DEFAULT_BOOTSTRAP_TIMEOUT;

    // Guarantee emit('error') never throws if the user hasn't attached a listener.
    this.on('error', (err) => this.logger.warn('cache-mesh error', err));

    this.server = new SyncServer<V>({
      port: opts.port,
      host: opts.host,
      namespace: opts.namespace,
      hmacSecret: opts.hmacSecret,
      logger: this.logger,
      onOp: (op) => this.onRemoteOp(op),
      snapshot: () => this.wrapper.entries(),
      snapshotCompression: opts.snapshotCompression,
    });

    this.client = new SyncClient<V>({
      namespace: opts.namespace,
      hmacSecret: opts.hmacSecret,
      requestTimeoutMs: opts.requestTimeoutMs,
      outboxCapacity: opts.outboxCapacity,
      maxConnectionsPerPeer: opts.maxConnectionsPerPeer,
      pipelining: opts.pipelining,
      logger: this.logger,
    });

    this.onPeerAdd = (peer) => this.emit('peer:add', peer);
    this.onPeerRemove = (peer) => {
      this.client.forgetPeer(peer.id);
      this.emit('peer:remove', peer);
    };
    this.onDiscoveryError = (err) => this.emit('error', err);

    this.discovery.on('peer:add', this.onPeerAdd);
    this.discovery.on('peer:remove', this.onPeerRemove);
    this.discovery.on('error', this.onDiscoveryError);
  }

  private detachDiscoveryListeners(): void {
    this.discovery.off('peer:add', this.onPeerAdd);
    this.discovery.off('peer:remove', this.onPeerRemove);
    this.discovery.off('error', this.onDiscoveryError);
  }

  async start(): Promise<void> {
    if (this.started) return;
    const cleanups: Array<() => Promise<void>> = [];
    try {
      await this.server.start();
      cleanups.push(() => this.server.stop());
      await this.discovery.start();
      cleanups.push(() => this.discovery.stop());
      await this.bootstrap();
      this.started = true;
      this.emit('ready');
    } catch (err) {
      for (const stop of cleanups.reverse()) {
        try {
          await stop();
        } catch (cleanupErr) {
          this.logger.warn('cleanup after failed start() threw', cleanupErr);
        }
      }
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.detachDiscoveryListeners();
    await this.discovery.stop();
    await this.server.stop();
    await this.client.close();
  }

  peers(): Peer[] {
    return this.discovery.peers();
  }

  get(key: string): V | undefined {
    return this.wrapper.get(key);
  }

  has(key: string): boolean {
    return this.wrapper.has(key);
  }

  set(key: string, value: V): void {
    const op = this.wrapper.localSet(key, value, this.clock.local());
    this.broadcast(op);
  }

  delete(key: string): void {
    const op = this.wrapper.localDelete(key, this.clock.local());
    this.broadcast(op);
  }

  clear(): void {
    const op = this.wrapper.localClear(this.clock.local());
    this.broadcast(op);
  }

  private broadcast(op: Op<V>): void {
    const peers = this.discovery.peers();
    if (peers.length === 0) return;
    this.client.broadcast(peers, op).catch((err) => this.emit('error', err));
  }

  private onRemoteOp(op: Op<V>): void {
    if (this.isSkewedFuture(op.hlc.p)) {
      this.logger.warn(`rejecting op with far-future HLC (p=${op.hlc.p}, now=${Date.now()})`);
      this.emit('sync:rejected', op);
      return;
    }
    this.clock.update(op.hlc);
    const accepted = this.wrapper.applyRemote(op);
    this.emit(accepted ? 'sync:applied' : 'sync:rejected', op);
  }

  private isSkewedFuture(p: number): boolean {
    return p - Date.now() > MAX_HLC_SKEW_MS;
  }

  private async bootstrap(): Promise<void> {
    const deadline = Date.now() + this.bootstrapTimeoutMs;
    const tried = new Set<string>();
    let from: Peer | null = null;
    let applied = 0;

    while (Date.now() < deadline) {
      const candidates = this.discovery.peers().filter((p) => !tried.has(p.id));
      if (candidates.length === 0) {
        // No peers yet — wait briefly, then retry.
        await sleep(Math.min(500, Math.max(0, deadline - Date.now())));
        continue;
      }

      const peer = candidates[Math.floor(Math.random() * candidates.length)]!;
      tried.add(peer.id);

      this.emit('bootstrap:started', peer);
      const stream = await this.client.snapshotFrom(peer);
      if (!stream) continue;

      try {
        for await (const entry of stream) {
          if (this.isSkewedFuture(entry.hlc.p)) {
            this.logger.warn(
              `skipping snapshot entry with far-future HLC from ${peer.host}:${peer.port}`,
            );
            continue;
          }
          this.clock.update(entry.hlc);
          const ok = this.wrapper.applyRemote({
            type: 'set',
            key: entry.key,
            value: entry.value,
            hlc: entry.hlc,
          });
          if (ok) applied += 1;
        }
        from = peer;
        break;
      } catch (err) {
        this.logger.warn(`snapshot stream from ${peer.host} failed`, err);
        this.emit('error', err);
      }
    }

    const outcome: BootstrapOutcome = from
      ? 'ok'
      : tried.size === 0
        ? 'empty-cluster'
        : 'all-failed';
    this.emit('bootstrap:finished', { from, applied, outcome });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
