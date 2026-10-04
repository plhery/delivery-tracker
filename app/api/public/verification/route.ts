import { apiRoute, json, readJsonObject } from '../../../../src/server/api';
import { turnstileSettings, verifyLookupBrowser } from '../../../../src/server/lookupVerification';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiRoute(async () => json({ siteKey: turnstileSettings()?.siteKey ?? null }), {
  authenticated: false, loadService: false, publicRateLimit: { limit: 60, window: 60 },
});

export const POST = apiRoute(async ({ request }) => {
  const { token } = await readJsonObject(request);
  return json(await verifyLookupBrowser(request, token));
}, {
  authenticated: false, loadService: false, capability: true,
  publicRateLimit: { limit: 10, window: 60 },
});
