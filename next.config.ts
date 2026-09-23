import type { NextConfig } from 'next';

// Define the base Next.js configuration
const nextConfig: NextConfig = {
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
  // Pin the tracing root so `output: standalone` emits server.js at the top
  // level (pnpm-workspace.yaml otherwise makes Next infer a parent root and
  // nest the app under ./WorldLoom/, breaking the container CMD).
  outputFileTracingRoot: __dirname,
  images: {},
  async headers() {
    const headers = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'X-DNS-Prefetch-Control', value: 'off' }
    ];
    return [{ source: '/(.*)', headers }];
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
  }
};

export default nextConfig;
