import { webAppManifestResponse } from '../../src/server/webAppManifest';

// The same for every request: written once, when the site is built.
export const dynamic = 'force-static';

/**
 * The installed app in English. Each other language has its own, such as
 * `/de/manifest.webmanifest`, and each page links the one in its language. This is a
 * route rather than Next's `app/manifest.ts`, whose link would replace the page's.
 */
export function GET() {
  return webAppManifestResponse('en');
}
