/**
 * Process-wide singleton registry keyed on `globalThis`. Survives Next.js HMR
 * and multiple module graphs (app router + pages router) in the same process.
 */
const KEY = Symbol.for('cache-mesh.singleton');

type Registry = Map<string, unknown>;

function registry(): Registry {
  const g = globalThis as Record<symbol, unknown>;
  let r = g[KEY] as Registry | undefined;
  if (!r) {
    r = new Map<string, unknown>();
    g[KEY] = r;
  }
  return r;
}

export function getOrCreate<T>(key: string, make: () => T): T {
  const r = registry();
  if (!r.has(key)) r.set(key, make());
  return r.get(key) as T;
}

export function get<T>(key: string): T | undefined {
  return registry().get(key) as T | undefined;
}

export function remove(key: string): void {
  registry().delete(key);
}
