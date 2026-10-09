import { webAppManifestResponse } from '../../../src/server/webAppManifest';

// The same for every request: written once, when the site is built.
export const dynamic = 'force-static';

/** The installed app in Spanish, as pages in Spanish link it. */
export function GET() {
  return webAppManifestResponse('es');
}
