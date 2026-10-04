import { apiRoute, json, readJsonObject } from '../../../../../src/server/api';
import { nativeChallenge } from '../../../../../src/server/nativeVerification';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = apiRoute(async ({ request }) => {
  const { keyId, purpose } = await readJsonObject(request);
  return json(nativeChallenge(request, keyId, purpose));
}, { authenticated: false, loadService: false, capability: true, publicRateLimit: { limit: 20, window: 60 } });
