import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The engine reads its worlds from .engine-store.json at runtime via a dynamic
  // readFileSync, which Next.js won't auto-trace into the serverless bundle.
  // Force-include the world files so the door has its shelf in production.
  outputFileTracingIncludes: {
    '/api/engine/**': ['./.engine-store.json', './.engine-saves.json'],
  },
  async redirects() {
    return [
      {
        // /play was renamed to /hub. Old links, bookmarks, and the /play URLs
        // already stored in notification rows keep working — no DB touched.
        source: '/play/:scene*',
        destination: '/hub/:scene*',
        permanent: true,
      },
      {
        source: '/deliberations/:path*',
        destination: '/talks/:path*',
        permanent: true,
      },
      {
        source: '/communities/:path*',
        destination: '/rallies/:path*',
        permanent: true,
      },
    ]
  },
  async headers() {
    return [
      {
        // Non-embed routes: block framing
        source: '/((?!embed|api/embed).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.vercel.app https://challenges.cloudflare.com https://*.up.railway.app wss://*.up.railway.app http://localhost:8080 ws://localhost:8080 http://localhost:3334; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
        ],
      },
      {
        // Embed pages: allow framing from any origin
        source: '/embed/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // Embed API: CORS headers for cross-origin requests
        source: '/api/embed/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, X-Plugin-Token, X-Community-Slug' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ]
  },
};

export default nextConfig;
