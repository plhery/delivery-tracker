import {
  apiRoute,
  HttpError,
  noContent,
  parseUuid,
  readJsonObject,
  requireService,
  requireUserClient,
  type RouteParameters,
} from '../../../../../src/server/api';
import { keepParcelFeedback } from '../../../../../src/server/parcelFeedback';
import { parcelFeedbackValues } from '../../../../../src/server/validation';

interface PackageParameters extends RouteParameters {
  id: string;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** What an account says of one of its parcels. The answer is kept without the account. */
export const POST = apiRoute<PackageParameters>(async (context) => {
  const { id } = await context.route.params;
  const packageId = parseUuid(id, 'package id');
  const values = parcelFeedbackValues(await readJsonObject(context.request));
  const parcel = await requireUserClient(context).getPackage(packageId);
  if (!parcel) throw new HttpError(404, 'Package not found');
  await keepParcelFeedback(requireService(context), parcel, values, 'account');
  return noContent();
}, { serviceRequired: true });
