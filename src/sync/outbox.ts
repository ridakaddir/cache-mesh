import type { Op } from '../store/types.js';

/**
 * Bounded per-peer outbox. When full, oldest entries are dropped — caches are
 * eventually consistent anyway, and an unbounded queue would leak memory on a
 * dead peer.
 */
export class Outbox<V> {
  private buf: Op<V>[] = [];
  constructor(private readonly capacity: number) {}

  push(op: Op<V>): void {
    if (this.buf.length >= this.capacity) this.buf.shift();
    this.buf.push(op);
  }

  drain(): Op<V>[] {
    const out = this.buf;
    this.buf = [];
    return out;
  }

  size(): number {
    return this.buf.length;
  }
}
