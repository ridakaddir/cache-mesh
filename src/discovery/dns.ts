import { promises as dns } from 'node:dns';
import { EventEmitter } from 'node:events';
import { type Logger, noopLogger } from '../util/logger.js';
import { detectSelfIp } from '../util/podIp.js';
import type { Discovery, DiscoveryEvents, Peer } from './types.js';

export type DnsDiscoveryOptions = {
  /** Headless service DNS name, e.g. 'my-app-headless.default.svc.cluster.local'. */
  host: string;
  /** Peer port to dial. */
  port: number;
  /** Poll interval ms. Default 5_000. */
  intervalMs?: number;
  /** Explicit self IP. Defaults to POD_IP env / network interface. */
  selfIp?: string;
  /** Custom resolver (for tests). */
  resolve?: (host: string) => Promise<string[]>;
  logger?: Logger;
};

const DEFAULT_INTERVAL_MS = 5_000;

export class DnsDiscovery extends EventEmitter implements Discovery {
  private timer: NodeJS.Timeout | undefined;
  private stopped = true;
  private current = new Map<string, Peer>();
  private readonly host: string;
  private readonly port: number;
  private readonly intervalMs: number;
  private readonly selfIp: string | undefined;
  private readonly resolve: (host: string) => Promise<string[]>;
  private readonly logger: Logger;

  constructor(opts: DnsDiscoveryOptions) {
    super();
    this.host = opts.host;
    this.port = opts.port;
    this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.selfIp = opts.selfIp ?? detectSelfIp();
    this.resolve = opts.resolve ?? ((h) => dns.resolve4(h));
    this.logger = opts.logger ?? noopLogger;
  }

  override on<K extends keyof DiscoveryEvents>(event: K, listener: DiscoveryEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override off<K extends keyof DiscoveryEvents>(event: K, listener: DiscoveryEvents[K]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.tick();
    this.schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  peers(): Peer[] {
    return Array.from(this.current.values());
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.tick().finally(() => this.schedule());
    }, this.intervalMs);
    // Don't keep event loop alive solely because of the discovery timer.
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    let ips: string[];
    try {
      ips = await this.resolve(this.host);
    } catch (err) {
      this.emit('error', err);
      this.logger.warn(`dns.resolve4(${this.host}) failed`, err);
      return;
    }

    const next = new Map<string, Peer>();
    for (const ip of ips) {
      if (this.selfIp && ip === this.selfIp) continue;
      next.set(ip, { id: ip, host: ip, port: this.port });
    }

    for (const [id, peer] of this.current) {
      if (!next.has(id)) {
        this.current.delete(id);
        this.emit('peer:remove', peer);
      }
    }
    for (const [id, peer] of next) {
      if (!this.current.has(id)) {
        this.current.set(id, peer);
        this.emit('peer:add', peer);
      }
    }
  }
}

export type StaticDiscoveryOptions = {
  peers: Peer[];
};

/**
 * Fixed peer list — intended for tests and local development.
 */
export class StaticDiscovery extends EventEmitter implements Discovery {
  private readonly _peers: Peer[];
  private started = false;

  constructor(opts: StaticDiscoveryOptions) {
    super();
    this._peers = [...opts.peers];
  }

  override on<K extends keyof DiscoveryEvents>(event: K, listener: DiscoveryEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override off<K extends keyof DiscoveryEvents>(event: K, listener: DiscoveryEvents[K]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const peer of this._peers) this.emit('peer:add', peer);
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  peers(): Peer[] {
    return [...this._peers];
  }
}
