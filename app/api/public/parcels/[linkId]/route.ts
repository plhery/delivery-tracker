import {
  apiRoute,
  json,
  noContent,
  requireService,
  type RouteParameters,
} from '../../../../../src/server/api';
import { wakeSyncWorker } from '../../../../../src/server/background';
import { recordParcelsForgotten, recordPublicParcelRead } from '../../../../../src/server/metrics';
import {
  isParcelLinkId,
  ownerKeyHash,
  PARCEL_UNAVAILABLE,
  publicParcelResponse,
} from '../../../../../src/server/publicParcels';
import { SupabaseError } from '../../../../../src/server/supabase';
import { isOpenedParcelSyncDue } from '../../../../../src/server/trackingSync';
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
 * the owner; anyone else is a viewer. A read records that the link was opened,
 * creates nothing, and queues a check of a one-off parcel that is due one.
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
  return json(publicParcelResponse(found) satisfies ApiPublicParcelResponse);
}, {
  authenticated: false,
  serviceRequired: true,
  capability: true,
  publicRateLimit: { limit: 120, window: 60, bucket: 'public-parcel' },
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
