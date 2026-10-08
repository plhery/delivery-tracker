import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['universal-parcel-scraper', 'playwright-core', 'onnxruntime-web', 'node-app-attest', 'cbor'],
  // OCR runs in a file-backed worker outside Next's import graph. Include its
  // model and Node WASM runtime so the standalone server can start it locally.
  outputFileTracingIncludes: {
    '/*': [
      './node_modules/universal-parcel-scraper/dist/**/*',
      './node_modules/universal-parcel-scraper/data/**/*',
      './node_modules/universal-parcel-scraper/package.json',
      './node_modules/onnxruntime-web/package.json',
      './node_modules/onnxruntime-web/dist/ort.node.min.{js,mjs}',
      './node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
      './node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
      './node_modules/onnxruntime-common/package.json',
      './node_modules/onnxruntime-common/dist/{cjs,esm}/*.js',
    ],
  },
  poweredByHeader: false,
  reactStrictMode: true,
  // Link previews may use browser-like user agents and only inspect the head.
  // Keep social metadata in the initial HTML for every client.
  htmlLimitedBots: /.*/,
  experimental: {
    // Keep production stack traces actionable without exposing browser maps.
    serverSourceMaps: true,
  },
  async redirects() {
    // English has no address of its own beside the other languages': its landing is `/`.
    return [{ source: '/en', destination: '/', permanent: true }];
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
        // A parcel link's address is the capability to read the parcel.
        source: '/p/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      {
        // The way out of the delivery email: its link names one account, after the `#`.
        source: '/email/off',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      {
        // The map's tiles: their address carries the version of the set, so a tile never changes under its address.
        source: '/atlas/:tile',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      // The link preview, in each language it is drawn in.
      ...['', '-de', '-fr', '-it', '-es', '-pt', '-pl'].map((language) => ({
        source: `/og${language}.png`,
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600, must-revalidate' },
        ],
      })),
    ];
  },
};

export default nextConfig;
