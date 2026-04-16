import type { HLC } from '../hlc.js';

/**
 * Minimal contract the user's cache store must satisfy. Deliberately loose so
 * lru-cache, node-cache, a plain Map, or any in-house implementation works.
 */
export interface MapLikeStore<V = unknown> {
  get(key: string): V | undefined;
  set(key: string, value: V): unknown;
  delete(key: string): boolean | void;
  has(key: string): boolean;
  /** Iterate current entries for snapshot. */
  entries(): IterableIterator<[string, V]> | Iterable<[string, V]>;
  /** Optional — used when implementing clear(). If absent we delete keys one by one. */
  clear?(): void;
}

export type OpSet<V = unknown> = {
  type: 'set';
  key: string;
  value: V;
  hlc: HLC;
};

export type OpDelete = {
  type: 'delete';
  key: string;
  hlc: HLC;
};

export type OpClear = {
  type: 'clear';
  hlc: HLC;
};

export type Op<V = unknown> = OpSet<V> | OpDelete | OpClear;

export type SnapshotEntry<V = unknown> = {
  key: string;
  value: V;
  hlc: HLC;
};
