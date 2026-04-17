import { compareHLC, type HLC } from '../hlc.js';
import type { MapLikeStore, Op, SnapshotEntry } from './types.js';

export type WrapperOptions = {
  /** How long tombstones are retained after a delete, in ms. */
  tombstoneTtlMs?: number;
};

const DEFAULT_TOMBSTONE_TTL_MS = 5 * 60 * 1000;

type Meta = {
  hlc: HLC;
  deleted: boolean;
  /** Wall-clock ms at which a tombstone becomes eligible for GC. */
  expiresAt?: number;
};

/**
 * Layers LWW semantics over a user-provided Map-like store. The user's store
 * only ever sees values; HLC metadata and tombstones live in a sidecar map so
 * we can reject stale writes and late resurrections without requiring the
 * user's cache to understand them.
 */
export class StoreWrapper<V> {
  private meta = new Map<string, Meta>();
  private tombstoneTtlMs: number;
  private clearHLC: HLC | null = null;
  /** Earliest `expiresAt` across all tombstones; gc scans are skipped until now >= this. */
  private nextExpiryMs = Number.POSITIVE_INFINITY;

  constructor(
    private store: MapLikeStore<V>,
    opts: WrapperOptions = {},
  ) {
    this.tombstoneTtlMs = opts.tombstoneTtlMs ?? DEFAULT_TOMBSTONE_TTL_MS;
  }

  get(key: string): V | undefined {
    this.maybeGcTombstones();
    const m = this.meta.get(key);
    if (m?.deleted) return undefined;
    return this.store.get(key);
  }

  has(key: string): boolean {
    this.maybeGcTombstones();
    const m = this.meta.get(key);
    if (m?.deleted) return false;
    return this.store.has(key);
  }

  /**
   * Apply a local write. The caller owns the HLC bump; we just record it.
   * Returns the op that should be broadcast.
   */
  localSet(key: string, value: V, hlc: HLC): Op<V> {
    this.store.set(key, value);
    this.meta.set(key, { hlc, deleted: false });
    return { type: 'set', key, value, hlc };
  }

  localDelete(key: string, hlc: HLC): Op<V> {
    this.store.delete(key);
    const expiresAt = Date.now() + this.tombstoneTtlMs;
    this.meta.set(key, { hlc, deleted: true, expiresAt });
    if (expiresAt < this.nextExpiryMs) this.nextExpiryMs = expiresAt;
    return { type: 'delete', key, hlc };
  }

  localClear(hlc: HLC): Op<V> {
    this.doClear();
    this.clearHLC = hlc;
    return { type: 'clear', hlc };
  }

  /**
   * Apply an op received from a peer. Returns true if the op was accepted and
   * changed local state.
   */
  applyRemote(op: Op<V>): boolean {
    if (op.type === 'clear') {
      if (this.clearHLC && compareHLC(op.hlc, this.clearHLC) <= 0) return false;
      this.doClear();
      this.clearHLC = op.hlc;
      return true;
    }

    if (this.clearHLC && compareHLC(op.hlc, this.clearHLC) <= 0) {
      // This op predates our latest clear and has no business resurrecting state.
      return false;
    }

    const existing = this.meta.get(op.key);
    if (existing && compareHLC(op.hlc, existing.hlc) <= 0) return false;

    if (op.type === 'set') {
      this.store.set(op.key, op.value);
      this.meta.set(op.key, { hlc: op.hlc, deleted: false });
    } else {
      this.store.delete(op.key);
      const expiresAt = Date.now() + this.tombstoneTtlMs;
      this.meta.set(op.key, { hlc: op.hlc, deleted: true, expiresAt });
      if (expiresAt < this.nextExpiryMs) this.nextExpiryMs = expiresAt;
    }
    return true;
  }

  *entries(): IterableIterator<SnapshotEntry<V>> {
    this.maybeGcTombstones();
    for (const [key, value] of this.store.entries()) {
      const m = this.meta.get(key);
      if (!m || m.deleted) continue;
      yield { key, value, hlc: m.hlc };
    }
  }

  size(): number {
    let n = 0;
    for (const [, m] of this.meta) if (!m.deleted) n += 1;
    return n;
  }

  private doClear(): void {
    if (typeof this.store.clear === 'function') {
      this.store.clear();
    } else {
      for (const [key] of this.store.entries()) this.store.delete(key);
    }
    this.meta.clear();
    this.nextExpiryMs = Number.POSITIVE_INFINITY;
  }

  private maybeGcTombstones(): void {
    const now = Date.now();
    if (now < this.nextExpiryMs) return;
    let next = Number.POSITIVE_INFINITY;
    for (const [key, m] of this.meta) {
      if (!m.deleted || m.expiresAt === undefined) continue;
      if (m.expiresAt <= now) {
        this.meta.delete(key);
      } else if (m.expiresAt < next) {
        next = m.expiresAt;
      }
    }
    this.nextExpiryMs = next;
  }
}
