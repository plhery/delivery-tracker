import 'server-only';
import type { MetadataRoute } from 'next';
import { documentLanguage, type Locale } from '../lib/locale';
import { siteTitle, wordsIn } from './sitePreview';

/**
 * The installed app, named and described in a language. Every language's
 * manifest names the same app (`id`, `start_url` and `scope` are `/`), so
 * installing it from a page in any language gives one app, which opens in the
 * reader's language.
 */
export function webAppManifest(locale: Locale): MetadataRoute.Manifest {
  const t = wordsIn(locale);
  return {
    name: siteTitle(t),
    short_name: 'Peek',
    description: t('preview.site.description'),
    lang: documentLanguage(locale),
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F4F5F1',
    theme_color: '#F4F5F1',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    share_target: {
      action: '/share-target',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: { title: 'title', text: 'text', url: 'url' },
    },
  } as MetadataRoute.Manifest;
}

/** A language's manifest as its own address answers it: `/manifest.webmanifest` in English, `/de/manifest.webmanifest` in German. */
export function webAppManifestResponse(locale: Locale): Response {
  return new Response(JSON.stringify(webAppManifest(locale)), {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
}
