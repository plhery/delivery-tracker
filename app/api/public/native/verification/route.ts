import { apiRoute, json, readJsonObject, requireService, noContent } from '../../../../../src/server/api';
import { nativeAttestSettings, registerNativeKey } from '../../../../../src/server/nativeVerification';
import { turnstileSettings } from '../../../../../src/server/lookupVerification';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiRoute(async () => json({
  appAttestAppId: nativeAttestSettings()?.appId ?? null,
  turnstile: turnstileSettings() !== null,
}), { authenticated: false, loadService: false, publicRateLimit: { limit: 30, window: 60 } });

export const POST = apiRoute(async (context) => {
  await registerNativeKey(context.request, requireService(context), await readJsonObject(context.request));
  return noContent();
}, { authenticated: false, serviceRequired: true, capability: true, publicRateLimit: { limit: 5, window: 60 } });
