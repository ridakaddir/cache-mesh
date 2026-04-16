/**
 * Hybrid Logical Clock.
 *
 * Each timestamp carries (physical ms, logical counter, nodeId). Strictly
 * ordered by that triple, so two writes on the same millisecond from different
 * nodes have a deterministic winner. Tolerates modest wall-clock skew between
 * peers because `physical` can advance past `Date.now()` when remote clocks
 * are ahead.
 */

export type HLC = {
  /** Wall-clock millis, monotonically non-decreasing across local + remote events. */
  p: number;
  /** Counter that increments when p does not advance. */
  l: number;
  /** Stable per-process id used as a tiebreaker. */
  n: string;
};

export type Clock = {
  now(): HLC;
  local(): HLC;
  update(remote: HLC): HLC;
};

export function compareHLC(a: HLC, b: HLC): number {
  if (a.p !== b.p) return a.p - b.p;
  if (a.l !== b.l) return a.l - b.l;
  if (a.n < b.n) return -1;
  if (a.n > b.n) return 1;
  return 0;
}

export function hlcGreater(a: HLC, b: HLC): boolean {
  return compareHLC(a, b) > 0;
}

export function createClock(nodeId: string, wallClock: () => number = Date.now): Clock {
  let p = 0;
  let l = 0;

  function local(): HLC {
    const phys = wallClock();
    if (phys > p) {
      p = phys;
      l = 0;
    } else {
      l += 1;
    }
    return { p, l, n: nodeId };
  }

  function update(remote: HLC): HLC {
    const phys = wallClock();
    const maxP = Math.max(p, remote.p, phys);
    if (maxP === p && maxP === remote.p) {
      l = Math.max(l, remote.l) + 1;
    } else if (maxP === p) {
      l += 1;
    } else if (maxP === remote.p) {
      l = remote.l + 1;
    } else {
      l = 0;
    }
    p = maxP;
    return { p, l, n: nodeId };
  }

  return {
    now: local,
    local,
    update,
  };
}
