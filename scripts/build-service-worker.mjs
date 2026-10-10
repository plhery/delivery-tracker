import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getManifest } from '@serwist/build';
import { build } from 'esbuild';
import { MODERN_BROWSERSLIST_TARGET } from 'next/constants.js';

// The worker is built once Next has written the browser's files, from those files:
// it does not depend on the bundler that wrote them.
const root = resolve(import.meta.dirname, '..');
const { polyfillFiles } = JSON.parse(await readFile(resolve(root, '.next/build-manifest.json'), 'utf8'));

const { manifestEntries, count, size, warnings } = await getManifest({
  globDirectory: root,
  globPatterns: [
    '.next/static/**/*',
    // Only files the browser uses. Fonts, social images and email templates in
    // public/ are read by the server, and the manifest is rendered per request.
    // The help page (support.html) is not precached: nothing in the app links to it,
    // and read from the network it is always the current text.
    'public/{icons/*,privacy.html,privacy.css,theme.css,push-sw.js}',
  ],
  // Modern browsers skip the nomodule polyfills, and only Sentry reads the source maps.
  globIgnores: [...polyfillFiles.map((file) => `.next/${file}`), '.next/static/**/*.map'],
  // Next names its built files after their contents.
  dontCacheBustURLsMatching: /^\.next\/static\//,
  manifestTransforms: [async (entries) => {
    const manifest = entries.map((entry) => ({
      ...entry,
      url: encodeURI(entry.url.startsWith('.next/') ? `/_next/${entry.url.slice('.next/'.length)}` : entry.url.slice('public'.length)),
    }));
    // Next's dynamic documents are not part of the public-file precache. Their
    // HTML needs the response's CSP nonce; refresh them whenever the built assets
    // change, so the app shell always matches the precached scripts.
    const revision = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    return {
      manifest: [...manifest, ...['/', '/~offline'].map((url) => ({ url, size: 0, revision }))],
      warnings: [],
    };
  }],
});
for (const warning of warnings) console.warn(warning);

await build({
  entryPoints: [resolve(root, 'app/sw.ts')],
  outfile: resolve(root, 'public/sw.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  // The browsers Next builds the app for.
  target: MODERN_BROWSERSLIST_TARGET.map((browser) => browser.replace(' ', '')),
  define: {
    'process.env.NODE_ENV': '"production"',
    'self.__SW_MANIFEST': JSON.stringify(manifestEntries),
  },
  logLevel: 'warning',
});

console.log(`Built the service worker, precaching ${count} files (${Math.round(size / 1024)} KiB).`);
