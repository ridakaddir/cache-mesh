import type { NextConfig } from 'next';

const config: NextConfig = {
  // Prevent Next.js from bundling cache-mesh's native deps (undici, node:*).
  // Required when using `output: 'standalone'` so the lib runs from node_modules at runtime.
  serverExternalPackages: ['cache-mesh'],
};

export default config;
