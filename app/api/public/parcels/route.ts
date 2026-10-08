import { verifyAmazonShippingAddition } from '../../../../src/server/amazonShippingEligibility';
import { verifyLookupRequest } from '../../../../src/server/lookupVerification';
import { apiRoute, clientIp, HttpError, json, readJsonObject, requireService, type ApiContext } from '../../../../src/server/api';
import { wakeSyncWorker } from '../../../../src/server/background';
import { lookupCountry, rememberLookupCountry } from '../../../../src/server/lookupCountry';
import { recordPublicLookup, type PublicLookupOutcome } from '../../../../src/server/metrics';
import { logOperationalEvent } from '../../../../src/server/observability';
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

/** How far a failed lookup got: its input, the browser proof, the daily allowance, Amazon or the database. */
type LookupStage = 'input' | 'verification' | 'allowance' | 'amazon' | 'saving';

/** Counts a lookup and logs how it ended. The number never goes in the log. */
function recordLookup(outcome: PublicLookupOutcome, requestId?: string): void {
  recordPublicLookup(outcome);
  logOperationalEvent('public_lookup', { request_id: requestId, outcome });
}

async function lookUp(context: ApiContext, progress: { stage: LookupStage }): Promise<Response> {
  const service = requireService(context);
  const verificationRequest = context.request.clone();
  // The name stays on the device: only the number, the carrier and its inputs are read.
  const body = await readJsonObject(context.request);
  const values = newPackageValues({ ...body, label: '' });
  lookupCountry(context.request, body.lookupCountryHint);
  progress.stage = 'verification';
  await verifyLookupRequest(verificationRequest, service);

  progress.stage = 'allowance';
  const now = new Date();
  const allowance = await claimLookup(service, clientIp(context.request), now);
  if (!allowance.allowed) {
    recordLookup(allowance.scope === 'global' ? 'limited_global'
      : allowance.scope === 'network' ? 'limited_network' : 'limited_daily', context.requestId);
    // `scope` lets a client offer signing in instead of a countdown to midnight.
    return json(
      { error: 'No lookups are left for today. Sign in to keep going.', scope: 'daily' },
      429,
      { 'Retry-After': String(secondsUntilUtcMidnight(now)) },
    );
  }
  // Amazon is asked only for a lookup that was counted.
  progress.stage = 'amazon';
  await verifyAmazonShippingAddition(values.carrier, values.trackingNumber);

  progress.stage = 'saving';
  const key = newOwnerKey();
  const created = await service.createOneOffParcel(values, ownerKeyHash(key)!);
  if (created.created) await rememberLookupCountry(service, created.package, context.request, body.lookupCountryHint);
  recordLookup(created.created ? 'created' : 'reused', context.requestId);
  try {
    await service.enqueueSyncJob({ packageId: String(created.package.id) });
    wakeSyncWorker();
  } catch (error) {
    // The first read of the link queues the check again.
    if (!(error instanceof SupabaseError)) throw error;
  }
  return json({ ...publicParcelResponse(created, parcelAlerts(service)), key } satisfies ApiPublicLookupResponse, 201);
}

/**
 * Follows one parcel without an account. The answer carries the link and,
 * this once, the owner key: the server keeps only its hash.
 */
export const POST = apiRoute(async (context) => {
  const progress = { stage: 'input' as LookupStage };
  try {
    return await lookUp(context, progress);
  } catch (error) {
    // A refusal names its status; any other failure is named by its class.
    logOperationalEvent('public_lookup', {
      request_id: context.requestId, outcome: 'failed', reason: progress.stage,
      status: error instanceof HttpError ? error.status : undefined,
      error_class: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
}, {
  authenticated: false,
  capability: true,
  serviceRequired: true,
  publicRateLimit: {
    limit: 6, window: 60, bucket: 'public-lookup', onLimited: () => recordLookup('limited_burst'),
  },
});
