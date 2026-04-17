import type { Op } from '../store/types.js';

/**
 * Bounded per-peer outbox backed by a circular buffer. When full, the oldest
 * entry is dropped (tracked via droppedCount) — caches are eventually
 * consistent, so an unbounded queue isn't worth the memory on a dead peer.
 */
export class Outbox<V> {
  private readonly buf: (Op<V> | undefined)[];
  private head = 0;
  private tail = 0;
  private count = 0;
  private _dropped = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`Outbox capacity must be a positive integer, got ${capacity}`);
    }
    this.buf = new Array(capacity);
  }

  push(op: Op<V>): void {
    if (this.count === this.capacity) {
      this.head = (this.head + 1) % this.capacity;
      this.count -= 1;
      this._dropped += 1;
    }
    this.buf[this.tail] = op;
    this.tail = (this.tail + 1) % this.capacity;
    this.count += 1;
  }

  drain(): Op<V>[] {
    const out: Op<V>[] = [];
    while (this.count > 0) {
      out.push(this.buf[this.head] as Op<V>);
      this.buf[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
      this.count -= 1;
    }
    return out;
  }

  size(): number {
    return this.count;
  }

  /** Monotonic count of ops dropped due to capacity. */
  droppedCount(): number {
    return this._dropped;
  }
}
