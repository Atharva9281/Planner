import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pinned because a stray lockfile in the home directory otherwise makes Turbopack infer the
  // wrong workspace root.
  turbopack: { root: __dirname },
};

export default nextConfig;
