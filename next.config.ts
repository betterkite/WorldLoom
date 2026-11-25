import type { NextConfig } from 'next';

// Define the base Next.js configuration
const nextConfig: NextConfig = {
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
  // Pin the tracing root so `output: standalone` emits server.js at the top
  // level (pnpm-workspace.yaml otherwise makes Next infer a parent root and
  // nest the app under ./WorldLoom/, breaking the container CMD).
  outputFileTracingRoot: __dirname,
  // Runtime model/ledger paths are supplied on the host. Dynamic filesystem
  // access must not pull repository sources, local caches or dotenv files into
  // the distributable server. Keep compiled code, dependencies and legal assets.
  outputFileTracingExcludes: {
    '/*': [
      './.env*',
      './**/.env*',
      './.git/**/*',
      './.github/**/*',
      './.agents/**/*',
      './.husky/**/*',
      './.vscode/**/*',
      './.codex/**/*',
      './.cache/**/*',
      './.pnpm-store/**/*',
      './src/**/*',
      './tests/**/*',
      './e2e/**/*',
      './docs/**/*',
      // Docker supplies the locked, architecture-selected ONNX packages.
      // Instrumentation traces are also normalized during payload assembly.
      './node_modules/**/onnxruntime-node',
      './node_modules/**/onnxruntime-node/**/*',
      './node_modules/**/onnxruntime-common',
      './node_modules/**/onnxruntime-common/**/*'
    ]
  },
  // Release the compiler worker before the full typecheck and keep build work
  // serial on local machines. Type errors still fail the normal build.
  experimental: {
    cpus: 1,
    webpackBuildWorker: true,
    webpackMemoryOptimizations: true,
    parallelServerCompiles: false,
    parallelServerBuildTraces: false
  },
  webpack(config, { dev }) {
    // Production builds prioritize bounded memory over warm-build speed.
    // Keep the compiler worker and every type, page and font check enabled.
    if (!dev) config.cache = false;
    return config;
  },
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
