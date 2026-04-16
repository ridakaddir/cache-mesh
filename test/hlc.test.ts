import { describe, expect, it } from 'vitest';
import { compareHLC, createClock, hlcGreater } from '../src/hlc.js';

describe('HLC', () => {
  it('local tick advances physical or logical', () => {
    let t = 1000;
    const clock = createClock('a', () => t);
    const h1 = clock.local();
    expect(h1).toEqual({ p: 1000, l: 0, n: 'a' });
    const h2 = clock.local(); // same wall-clock ms
    expect(h2).toEqual({ p: 1000, l: 1, n: 'a' });
    t = 1005;
    const h3 = clock.local();
    expect(h3).toEqual({ p: 1005, l: 0, n: 'a' });
  });

  it('update absorbs remote timestamps', () => {
    const t = 1000;
    const clock = createClock('a', () => t);
    clock.local(); // {1000,0,a}
    const merged = clock.update({ p: 2000, l: 3, n: 'b' });
    expect(merged.p).toBe(2000);
    expect(merged.l).toBe(4);
    expect(merged.n).toBe('a');
  });

  it('ordering is total with nodeId tiebreaker', () => {
    const a = { p: 1000, l: 0, n: 'a' };
    const b = { p: 1000, l: 0, n: 'b' };
    expect(compareHLC(a, b)).toBeLessThan(0);
    expect(compareHLC(b, a)).toBeGreaterThan(0);
    expect(compareHLC(a, a)).toBe(0);
  });

  it('hlcGreater compares (p, l, n)', () => {
    expect(hlcGreater({ p: 2, l: 0, n: 'a' }, { p: 1, l: 99, n: 'z' })).toBe(true);
    expect(hlcGreater({ p: 1, l: 1, n: 'a' }, { p: 1, l: 0, n: 'z' })).toBe(true);
    expect(hlcGreater({ p: 1, l: 0, n: 'b' }, { p: 1, l: 0, n: 'a' })).toBe(true);
    expect(hlcGreater({ p: 1, l: 0, n: 'a' }, { p: 1, l: 0, n: 'b' })).toBe(false);
  });

  it('tolerates wall-clock regression', () => {
    let t = 2000;
    const clock = createClock('a', () => t);
    clock.local(); // {2000,0,a}
    t = 1500; // clock went backwards
    const h = clock.local();
    expect(h.p).toBe(2000); // stays at max
    expect(h.l).toBe(1);
  });
});
