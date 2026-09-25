import { createHash } from 'node:crypto';
import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
  // Registration lives in ClientApplication so updateViaCache and reload
  // behavior are explicit and covered by the application tests.
  register: false,
  // Only files the browser uses. Fonts, social images and email templates in
  // public/ are read by the server, and the manifest is rendered per request.
  globPublicPatterns: ['icons/*', 'privacy.html', 'privacy.css', 'theme.css', 'push-sw.js'],
  // The App Router never loads the Pages Router runtime (framework, main), and
  // modern browsers skip the nomodule polyfills. Route handlers get empty
  // client chunks.
  exclude: [
    /^static\/chunks\/(?:framework|main|polyfills)-[0-9a-f]+\.js$/,
    /^static\/chunks\/app\/(?:api|health|manifest\.webmanifest)\//,
  ],
  // Next's dynamic documents are not part of the public-file precache. Their
  // HTML needs the response's CSP nonce; refresh them whenever the built assets
  // change, so the app shell always matches the precached scripts.
  manifestTransforms: [async (entries) => {
    const revision = createHash('sha256').update(JSON.stringify(entries)).digest('hex');
    return {
      manifest: [...entries, ...['/', '/~offline'].map((url) => ({ url, size: 0, revision }))],
      warnings: [],
    };
  }],
});

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['playwright-core'],
  poweredByHeader: false,
  reactStrictMode: true,
  // Link previews may use browser-like user agents and only inspect the head.
  // Keep social metadata in the initial HTML for every client.
  htmlLimitedBots: /.*/,
  experimental: {
    // Keep production stack traces actionable without exposing browser maps.
    serverSourceMaps: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(), payment=(), usb=()' },
        ],
      },
      {
        source: '/invite/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      {
        source: '/i/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/og.png',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600, must-revalidate' },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
