import { withSerwist } from '@serwist/turbopack';
import type { NextConfig } from 'next';

// Server-side only: where the Express API lives. The browser always calls same-origin /api/*,
// so the tenant is resolved from the browser's host (X-Forwarded-Host) and no CORS is needed.
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@hr/shared'],
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_URL}/api/:path*` },
      { source: '/healthz', destination: `${API_URL}/health` },
    ];
  },
};

export default withSerwist(nextConfig);
