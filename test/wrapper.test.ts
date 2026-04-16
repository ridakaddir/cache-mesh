import { describe, expect, it } from 'vitest';
import { createClock } from '../src/hlc.js';
import { StoreWrapper } from '../src/store/wrapper.js';

function make() {
  const store = new Map<string, string>();
  const w = new StoreWrapper<string>(store);
  const clock = createClock('n1');
  return { store, w, clock };
}

describe('StoreWrapper', () => {
  it('local set/get/delete works', () => {
    const { w, clock } = make();
    w.localSet('k', 'v1', clock.local());
    expect(w.get('k')).toBe('v1');
    w.localDelete('k', clock.local());
    expect(w.get('k')).toBeUndefined();
    expect(w.has('k')).toBe(false);
  });

  it('applyRemote rejects stale writes (LWW)', () => {
    const { w, clock } = make();
    const first = clock.local();
    w.localSet('k', 'v1', clock.local());
    const changed = w.applyRemote({ type: 'set', key: 'k', value: 'old', hlc: first });
    expect(changed).toBe(false);
    expect(w.get('k')).toBe('v1');
  });

  it('applyRemote accepts newer writes', () => {
    const { w, clock } = make();
    w.localSet('k', 'v1', clock.local());
    const remote = { p: Date.now() + 10_000, l: 0, n: 'n2' };
    const changed = w.applyRemote({ type: 'set', key: 'k', value: 'v2', hlc: remote });
    expect(changed).toBe(true);
    expect(w.get('k')).toBe('v2');
  });

  it('tombstones reject resurrection by older ops', () => {
    const { w, clock } = make();
    const setHlc = clock.local();
    const delHlc = clock.local();
    w.applyRemote({ type: 'set', key: 'k', value: 'v', hlc: setHlc });
    w.applyRemote({ type: 'delete', key: 'k', hlc: delHlc });
    const changed = w.applyRemote({ type: 'set', key: 'k', value: 'old', hlc: setHlc });
    expect(changed).toBe(false);
    expect(w.has('k')).toBe(false);
  });

  it('clear invalidates older ops', () => {
    const { w, clock } = make();
    w.localSet('a', '1', clock.local());
    const clearHlc = clock.local();
    w.applyRemote({ type: 'clear', hlc: clearHlc });
    expect(w.get('a')).toBeUndefined();
    // late-arriving op older than the clear is dropped
    const older = { p: 0, l: 0, n: 'n0' };
    const changed = w.applyRemote({ type: 'set', key: 'a', value: 'resurrect', hlc: older });
    expect(changed).toBe(false);
  });

  it('entries() snapshots live keys only', () => {
    const { w, clock } = make();
    w.localSet('a', '1', clock.local());
    w.localSet('b', '2', clock.local());
    w.localDelete('a', clock.local());
    const keys = Array.from(w.entries()).map((e) => e.key);
    expect(keys).toEqual(['b']);
  });

  it('concurrent writes converge by HLC ordering', () => {
    const w1 = new StoreWrapper<string>(new Map());
    const w2 = new StoreWrapper<string>(new Map());
    const c1 = createClock('a');
    const c2 = createClock('b');

    const op1 = w1.localSet('k', 'from-a', c1.local());
    const op2 = w2.localSet('k', 'from-b', c2.local());

    w1.applyRemote(op2);
    w2.applyRemote(op1);
    expect(w1.get('k')).toBe(w2.get('k'));
  });
});
