import { withSerwist } from '@serwist/turbopack';
import type { NextConfig } from 'next';

// Server-side only: where the Express API lives. The browser always calls same-origin /api/*,
// so the tenant is resolved from the browser's host (X-Forwarded-Host) and no CORS is needed.
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

// Supabase Auth is the only cross-origin call the browser makes. Production tenants live on
// *.supabase.co; CSP_CONNECT_EXTRA adds other origins (default: local Supabase for dev and e2e).
const connectExtra =
  process.env.CSP_CONNECT_EXTRA ?? 'http://127.0.0.1:54321 http://localhost:54321';
const dev = process.env.NODE_ENV !== 'production';

const csp = [
  "default-src 'self'",
  // Next.js inlines its bootstrap script; dev mode also needs eval for fast refresh.
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  // Signed storage URLs (logos, photos) and blob: previews.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co ${connectExtra}`.trim(),
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Location is used for clock-in on this origin only.
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=(), payment=()' },
  ...(dev
    ? []
    : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
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
