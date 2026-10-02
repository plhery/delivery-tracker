import {
  apiRoute,
  HttpError,
  json,
  noContent,
  readJsonObject,
  requireService,
  type RouteParameters,
} from '../../../../../../src/server/api';
import { recordParcelAlertRemoved, recordParcelAlertSet } from '../../../../../../src/server/metrics';
import {
  isParcelLinkId,
  ownerKeyHash,
  PARCEL_NOT_SHARED,
  PARCEL_UNAVAILABLE,
  parcelAlerts,
} from '../../../../../../src/server/publicParcels';
import { parcelAlert, pushEndpoint } from '../../../../../../src/server/validation';

interface LinkParameters extends RouteParameters {
  linkId: string;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const limits = { limit: 20, window: 60, bucket: 'public-parcel-alerts' };

/**
 * Turns on notifications in the caller's browser for this one parcel, until
 * it is delivered. Anyone holding the link may. The subscription is checked
 * as an account's is; the endpoint and its keys are stored and never returned
 * or logged.
 */
export const PUT = apiRoute<LinkParameters>(async (context) => {
  const { linkId } = await context.route.params;
  const alert = parcelAlert(await readJsonObject(context.request));
  const service = requireService(context);
  if (!parcelAlerts(service).available) throw new HttpError(503, 'Push notifications are not configured');
  // A malformed id is an unknown link: the answer never says which.
  const outcome = isParcelLinkId(linkId)
    ? await service.addParcelLinkAlert(linkId, ownerKeyHash(context.request.headers.get('x-parcel-key')), alert)
    : null;
  recordParcelAlertSet(outcome ?? 'unavailable');
  if (outcome === null) return json({ error: PARCEL_UNAVAILABLE }, 404);
  if (outcome === 'stopped') return json({ error: PARCEL_NOT_SHARED }, 410);
  if (outcome === 'full') return json({ error: 'This parcel has all the alerts it can take' }, 409);
  // A journey that is over has nothing left to announce: the alert has already ended.
  return noContent();
}, { authenticated: false, serviceRequired: true, capability: true, publicRateLimit: limits });

/**
 * Turns the browser's alert off. Knowing the endpoint is the right to: only
 * the browser that subscribed has it. The answer is the same when there was
 * no such alert or no such link.
 */
export const DELETE = apiRoute<LinkParameters>(async (context) => {
  const { linkId } = await context.route.params;
  const endpoint = pushEndpoint((await readJsonObject(context.request)).endpoint);
  if (isParcelLinkId(linkId) && await requireService(context).removeParcelLinkAlert(linkId, endpoint)) {
    recordParcelAlertRemoved('asked');
  }
  return noContent();
}, { authenticated: false, serviceRequired: true, capability: true, publicRateLimit: limits });
