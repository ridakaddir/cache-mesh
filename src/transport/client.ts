import { createGunzip } from 'node:zlib';
import { Agent, request } from 'undici';
import type { Peer } from '../discovery/types.js';
import type { Op, SnapshotEntry } from '../store/types.js';
import { Outbox } from '../sync/outbox.js';
import { type Logger, noopLogger } from '../util/logger.js';
import { parseNdjson } from '../util/ndjson.js';
import { NS_HEADER, SIG_HEADER, sign, TS_HEADER } from './auth.js';

export type SyncClientOptions = {
  namespace: string;
  hmacSecret: string;
  /** Per-request timeout ms. Default 2_000. */
  requestTimeoutMs?: number;
  /** Per-peer outbox capacity. Default 1_000. */
  outboxCapacity?: number;
  /** undici connection pool size per peer. Default 8. */
  maxConnectionsPerPeer?: number;
  /** undici pipelining depth — concurrent in-flight requests per connection. Default 1. */
  pipelining?: number;
  logger?: Logger;
};

const DEFAULT_TIMEOUT = 2_000;
const DEFAULT_OUTBOX = 1_000;
const DEFAULT_CONNECTIONS = 8;
const DEFAULT_PIPELINING = 1;

export class SyncClient<V> {
  private readonly agent: Agent;
  private readonly outboxes = new Map<string, Outbox<V>>();
  private readonly logger: Logger;
  private readonly timeout: number;
  private readonly outboxCap: number;

  constructor(private readonly opts: SyncClientOptions) {
    this.logger = opts.logger ?? noopLogger;
    this.timeout = opts.requestTimeoutMs ?? DEFAULT_TIMEOUT;
    this.outboxCap = opts.outboxCapacity ?? DEFAULT_OUTBOX;
    this.agent = new Agent({
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
      connections: opts.maxConnectionsPerPeer ?? DEFAULT_CONNECTIONS,
      pipelining: opts.pipelining ?? DEFAULT_PIPELINING,
    });
  }

  async close(): Promise<void> {
    await this.agent.close();
  }

  forgetPeer(id: string): void {
    this.outboxes.delete(id);
  }

  /**
   * Fire-and-forget broadcast to every peer. Failures queue into per-peer
   * outboxes and are replayed on the next successful op to that peer.
   */
  async broadcast(peers: Peer[], op: Op<V>): Promise<void> {
    await Promise.allSettled(peers.map((peer) => this.sendOne(peer, op)));
  }

  async snapshotFrom(peer: Peer): Promise<AsyncGenerator<SnapshotEntry<V>> | null> {
    const path = '/sync/snapshot';
    const ts = Date.now();
    const sig = sign(this.opts.hmacSecret, { ts, method: 'GET', path, body: '' });

    try {
      const res = await request(`http://${peer.host}:${peer.port}${path}`, {
        method: 'GET',
        dispatcher: this.agent,
        headersTimeout: this.timeout,
        bodyTimeout: this.timeout * 5,
        headers: {
          [NS_HEADER]: this.opts.namespace,
          [TS_HEADER]: String(ts),
          [SIG_HEADER]: sig,
          'accept-encoding': 'gzip',
        },
      });
      if (res.statusCode !== 200) {
        this.logger.warn(`snapshot from ${peer.host}:${peer.port} status ${res.statusCode}`);
        res.body.dump().catch(() => {});
        return null;
      }
      const encoding = headerValue(res.headers['content-encoding']);
      const stream =
        encoding?.toLowerCase() === 'gzip'
          ? (res.body.pipe(createGunzip()) as AsyncIterable<Uint8Array>)
          : res.body;
      return parseNdjson<SnapshotEntry<V>>(stream);
    } catch (err) {
      this.logger.warn(`snapshot from ${peer.host}:${peer.port} failed`, err);
      return null;
    }
  }

  private outboxFor(id: string): Outbox<V> {
    let o = this.outboxes.get(id);
    if (!o) {
      o = new Outbox<V>(this.outboxCap);
      this.outboxes.set(id, o);
    }
    return o;
  }

  private async sendOne(peer: Peer, op: Op<V>): Promise<void> {
    const outbox = this.outboxFor(peer.id);
    const queued = outbox.drain();
    queued.push(op);

    for (const queuedOp of queued) {
      const ok = await this.postOp(peer, queuedOp);
      if (!ok) {
        // Requeue this one and everything after it, preserving order.
        const before = outbox.droppedCount();
        const idx = queued.indexOf(queuedOp);
        for (const remaining of queued.slice(idx)) outbox.push(remaining);
        const dropped = outbox.droppedCount() - before;
        if (dropped > 0) {
          this.logger.warn(
            `outbox for ${peer.host}:${peer.port} dropped ${dropped} ops (capacity ${this.outboxCap})`,
          );
        }
        return;
      }
    }
  }

  private async postOp(peer: Peer, op: Op<V>): Promise<boolean> {
    const path = '/sync/op';
    const body = JSON.stringify(op);
    const ts = Date.now();
    const sig = sign(this.opts.hmacSecret, { ts, method: 'POST', path, body });

    try {
      const res = await request(`http://${peer.host}:${peer.port}${path}`, {
        method: 'POST',
        dispatcher: this.agent,
        headersTimeout: this.timeout,
        bodyTimeout: this.timeout,
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
          [NS_HEADER]: this.opts.namespace,
          [TS_HEADER]: String(ts),
          [SIG_HEADER]: sig,
        },
        body,
      });
      res.body.dump().catch(() => {});
      if (res.statusCode === 204 || res.statusCode === 200) return true;
      this.logger.warn(`POST /sync/op to ${peer.host}:${peer.port} status ${res.statusCode}`);
      return false;
    } catch (err) {
      this.logger.debug(`POST /sync/op to ${peer.host}:${peer.port} failed`, err);
      return false;
    }
  }
}

function headerValue(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
