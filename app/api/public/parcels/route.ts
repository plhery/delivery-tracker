import { verifyAmazonShippingAddition } from '../../../../src/server/amazonShippingEligibility';
import { requireLookupProof } from '../../../../src/server/lookupVerification';
import { apiRoute, clientIp, json, readJsonObject, requireService } from '../../../../src/server/api';
import { wakeSyncWorker } from '../../../../src/server/background';
import { rememberLookupCountry } from '../../../../src/server/lookupCountry';
import { recordPublicLookup } from '../../../../src/server/metrics';
import {
  claimLookup,
  newOwnerKey,
  ownerKeyHash,
  parcelAlerts,
  publicParcelResponse,
  secondsUntilUtcMidnight,
} from '../../../../src/server/publicParcels';
import { SupabaseError } from '../../../../src/server/supabase';
import { newPackageValues } from '../../../../src/server/validation';
import type { ApiPublicLookupResponse } from '../../../../src/generated/apiContract';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Follows one parcel without an account. The answer carries the link and,
 * this once, the owner key: the server keeps only its hash.
 */
export const POST = apiRoute(async (context) => {
  const service = requireService(context);
  // The name stays on the device: only the number, the carrier and its inputs are read.
  const values = newPackageValues({ ...await readJsonObject(context.request), label: '' });
  requireLookupProof(context.request);

  const now = new Date();
  const allowance = await claimLookup(service, clientIp(context.request), now);
  if (!allowance.allowed) {
    recordPublicLookup(allowance.scope === 'global' ? 'limited_global'
      : allowance.scope === 'network' ? 'limited_network' : 'limited_daily');
    // `scope` lets a client offer signing in instead of a countdown to midnight.
    return json(
      { error: 'No lookups are left for today. Sign in to keep going.', scope: 'daily' },
      429,
      { 'Retry-After': String(secondsUntilUtcMidnight(now)) },
    );
  }
  // Amazon is asked only for a lookup that was counted.
  await verifyAmazonShippingAddition(values.carrier, values.trackingNumber);

  const key = newOwnerKey();
  const created = await service.createOneOffParcel(values, ownerKeyHash(key)!);
  if (created.created) await rememberLookupCountry(service, created.package, context.request);
  recordPublicLookup(created.created ? 'created' : 'reused');
  try {
    await service.enqueueSyncJob({ packageId: String(created.package.id) });
    wakeSyncWorker();
  } catch (error) {
    // The first read of the link queues the check again.
    if (!(error instanceof SupabaseError)) throw error;
  }
  return json({ ...publicParcelResponse(created, parcelAlerts(service)), key } satisfies ApiPublicLookupResponse, 201);
}, {
  authenticated: false,
  serviceRequired: true,
  publicRateLimit: {
    limit: 6, window: 60, bucket: 'public-lookup', onLimited: () => recordPublicLookup('limited_burst'),
  },
});
