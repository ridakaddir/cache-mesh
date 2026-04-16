import type { Op, SnapshotEntry } from '../store/types.js';

export type OpHandler<V> = (op: Op<V>) => void;
export type SnapshotIterator<V> = () => Iterable<SnapshotEntry<V>>;
