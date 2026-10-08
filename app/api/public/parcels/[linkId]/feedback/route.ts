import {
  apiRoute,
  json,
  noContent,
  readJsonObject,
  requireService,
  type RouteParameters,
} from '../../../../../../src/server/api';
import { keepParcelFeedback } from '../../../../../../src/server/parcelFeedback';
import {
  isParcelLinkId,
  ownerKeyHash,
  PARCEL_NOT_SHARED,
  PARCEL_UNAVAILABLE,
} from '../../../../../../src/server/publicParcels';
import { parcelFeedbackValues } from '../../../../../../src/server/validation';

interface LinkParameters extends RouteParameters {
  linkId: string;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const limits = { limit: 20, window: 60, bucket: 'public-parcel-feedback' };

/**
 * What the holder of a link says of its parcel. A gift does not ask the one
 * it is for, so it takes no answer from them either. Answering is not an
 * opening of the link.
 */
export const POST = apiRoute<LinkParameters>(async (context) => {
  const { linkId } = await context.route.params;
  const values = parcelFeedbackValues(await readJsonObject(context.request));
  const service = requireService(context);
  const found = isParcelLinkId(linkId)
    ? await service.publicParcel(linkId, ownerKeyHash(context.request.headers.get('x-parcel-key')), false)
    : null;
  if (found === null) return json({ error: PARCEL_UNAVAILABLE }, 404);
  if (found === 'stopped') return json({ error: PARCEL_NOT_SHARED }, 410);
  if (found.link.gift === true && found.link.owner !== true) return json({ error: PARCEL_UNAVAILABLE }, 404);
  await keepParcelFeedback(service, found.package, values, 'link');
  return noContent();
}, { authenticated: false, serviceRequired: true, capability: true, publicRateLimit: limits });
