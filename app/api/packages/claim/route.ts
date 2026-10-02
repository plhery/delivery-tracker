import {
  apiRoute,
  HttpError,
  json,
  readJsonObject,
  requireService,
  requireUser,
  requireUserClient,
} from '../../../../src/server/api';
import { wakeSyncWorker } from '../../../../src/server/background';
import { recordParcelClaim } from '../../../../src/server/metrics';
import { isParcelLinkId, ownerKeyHash } from '../../../../src/server/publicParcels';
import { SupabaseError } from '../../../../src/server/supabase';
import { isRecord } from '../../../../src/server/types';
import { packageLabel } from '../../../../src/server/validation';
import type { ApiClaimParcelResult, ApiClaimParcelsResponse } from '../../../../src/generated/apiContract';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_LINKS = 20;

/**
 * Keeps parcels followed without an account in the signed-in account: the
 * lookups of this device, proven by their owner keys, and links that show
 * their number. The database decides each link under the caller's own token.
 */
export const POST = apiRoute(async (context) => {
  const { links } = await readJsonObject(context.request);
  if (!Array.isArray(links) || links.length < 1 || links.length > MAX_LINKS) {
    throw new HttpError(400, `Send between 1 and ${MAX_LINKS} parcel links`);
  }
  const requested = links.map((link) => {
    if (!isRecord(link) || typeof link.id !== 'string' || (link.key != null && typeof link.key !== 'string')) {
      throw new HttpError(400, 'Send a valid parcel link');
    }
    return { id: link.id, keyHash: ownerKeyHash(link.key), label: packageLabel({ label: link.label ?? '' }) };
  });

  const client = requireUserClient(context);
  const service = requireService(context);
  const userId = requireUser(context).id;
  const results: ApiClaimParcelResult[] = [];
  let queued = false;
  for (const link of requested) {
    // A malformed id is an unknown link: the answer never says which.
    const claimed = isParcelLinkId(link.id) ? await client.claimParcelLink(link.id, link.keyHash, link.label) : null;
    const outcome = claimed?.outcome ?? 'unavailable';
    recordParcelClaim(outcome);
    results.push({ id: link.id, outcome, ...(claimed?.packageId ? { packageId: claimed.packageId } : {}) });
    if (claimed?.outcome !== 'kept' || !claimed.packageId) continue;
    try {
      await service.enqueueSyncJob({ userId, packageId: claimed.packageId });
      queued = true;
    } catch (error) {
      // The parcel is kept; the scheduled run checks it.
      if (!(error instanceof SupabaseError)) throw error;
    }
  }
  if (queued) wakeSyncWorker();
  return json({ results } satisfies ApiClaimParcelsResponse);
}, { serviceRequired: true, capability: true });
