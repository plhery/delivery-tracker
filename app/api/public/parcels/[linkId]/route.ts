import {
  apiRoute,
  json,
  noContent,
  readJsonObject,
  requireService,
  type RouteParameters,
} from '../../../../../src/server/api';
import { wakeSyncWorker } from '../../../../../src/server/background';
import { recordParcelShare, recordParcelsForgotten, recordPublicParcelRead } from '../../../../../src/server/metrics';
import {
  isParcelLinkId,
  ownerKeyHash,
  PARCEL_NOT_SHARED,
  PARCEL_UNAVAILABLE,
  parcelAlerts,
  publicParcelResponse,
} from '../../../../../src/server/publicParcels';
import { SupabaseError } from '../../../../../src/server/supabase';
import { isOpenedParcelSyncDue } from '../../../../../src/server/trackingSync';
import { shareSwitches } from '../../../../../src/server/validation';
import type { ApiPublicParcelResponse } from '../../../../../src/generated/apiContract';

interface LinkParameters extends RouteParameters {
  linkId: string;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** One answer for every link that cannot be shown, whatever the reason. */
const unavailable = () => json({ error: PARCEL_UNAVAILABLE }, 404);

/**
 * Reads a parcel through its link. With the lookup's owner key the caller is
 * the owner; anyone else is a viewer, who is told when the sharing was
 * stopped. A read records that the link was opened, creates nothing, and
 * queues a check of a one-off parcel that is due one.
 */
export const GET = apiRoute<LinkParameters>(async (context) => {
  const { linkId } = await context.route.params;
  const service = requireService(context);
  const found = isParcelLinkId(linkId)
    ? await service.publicParcel(linkId, ownerKeyHash(context.request.headers.get('x-parcel-key')), true)
    : null;
  if (!found) {
    recordPublicParcelRead('not_found');
    return unavailable();
  }
  if (found === 'stopped') {
    recordPublicParcelRead('stopped');
    return json({ error: PARCEL_NOT_SHARED }, 410);
  }
  if (found.package.one_off === true && isOpenedParcelSyncDue(found.package, new Date())) {
    try {
      await service.enqueueSyncJob({ packageId: String(found.package.id) });
      wakeSyncWorker();
    } catch (error) {
      // The parcel is still readable; the next read asks again.
      if (!(error instanceof SupabaseError)) throw error;
    }
  }
  recordPublicParcelRead('ok');
  return json(publicParcelResponse(found, parcelAlerts(service)) satisfies ApiPublicParcelResponse);
}, {
  authenticated: false,
  serviceRequired: true,
  capability: true,
  publicRateLimit: { limit: 120, window: 60, bucket: 'public-parcel' },
});

/**
 * Changes what a lookup's link shows its viewers, makes it a gift, or stops
 * and resumes its sharing. Only the owner key may: an unknown link and a
 * wrong or missing key answer alike.
 */
export const PATCH = apiRoute<LinkParameters>(async (context) => {
  const { linkId } = await context.route.params;
  const changes = shareSwitches(await readJsonObject(context.request), ['showNumber', 'gift', 'shared']);
  const keyHash = ownerKeyHash(context.request.headers.get('x-parcel-key'));
  const service = requireService(context);
  const updated = isParcelLinkId(linkId) && keyHash ? await service.updateParcelLink(linkId, keyHash, changes) : null;
  if (!updated) return unavailable();
  recordParcelShare('lookup', updated.transition ?? 'changed');
  return json(publicParcelResponse(updated, parcelAlerts(service)) satisfies ApiPublicParcelResponse);
}, {
  authenticated: false,
  serviceRequired: true,
  capability: true,
  publicRateLimit: { limit: 30, window: 60, bucket: 'public-parcel-update' },
});

/** Forgets a lookup. An unknown link and a wrong or missing key answer alike. */
export const DELETE = apiRoute<LinkParameters>(async (context) => {
  const { linkId } = await context.route.params;
  const keyHash = ownerKeyHash(context.request.headers.get('x-parcel-key'));
  const forgotten = isParcelLinkId(linkId) && keyHash
    ? await requireService(context).forgetParcelLink(linkId, keyHash)
    : { links: 0, packages: 0 };
  if (forgotten.links === 0) return unavailable();
  recordParcelsForgotten('asked', forgotten);
  return noContent();
}, {
  authenticated: false,
  serviceRequired: true,
  capability: true,
  publicRateLimit: { limit: 30, window: 60, bucket: 'public-parcel-forget' },
});
