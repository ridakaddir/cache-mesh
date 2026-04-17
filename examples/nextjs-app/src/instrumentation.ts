/**
 * Next.js calls register() exactly once per server process, before the first
 * request. Perfect place to boot the cache-mesh coordinator so discovery and
 * the HTTP sync port are up for incoming traffic.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { getCache } = await import('./lib/cache');
  const cache = getCache();
  await cache.start();

  const shutdown = async () => {
    await cache.stop();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
