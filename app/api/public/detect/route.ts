import { apiRoute, clientIp, HttpError, json, readJsonObject, requireService } from '../../../../src/server/api';
import { detectCarrier } from '../../../../src/server/carrierDetection';
import { requireLookupProof } from '../../../../src/server/lookupVerification';
import { recordPublicDetection } from '../../../../src/server/metrics';
import { claimDetection, secondsUntilUtcMidnight } from '../../../../src/server/publicParcels';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The front door detects the carrier before anyone signs in. A number whose
 * shape names its carrier is answered at once. Asking carriers about one is
 * counted against the day's allowances first, the client's and everyone's:
 * past them the answer is a refusal, and the lookup works without it.
 */
export const POST = apiRoute(async (context) => {
  const body = await readJsonObject(context.request);
  return json(await detectCarrier(body, async () => {
    requireLookupProof(context.request);
    const now = new Date();
    const allowance = await claimDetection(requireService(context), clientIp(context.request), now);
    if (!allowance.allowed) {
      recordPublicDetection(allowance.scope === 'global' ? 'limited_global' : 'limited_daily');
      throw new HttpError(429, 'No carrier checks are left for today.', { 'Retry-After': String(secondsUntilUtcMidnight(now)) });
    }
    recordPublicDetection('asked');
  }));
}, {
  authenticated: false,
  publicRateLimit: { limit: 20, window: 60, onLimited: () => recordPublicDetection('limited_burst') },
});
