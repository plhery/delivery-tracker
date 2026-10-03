import {
  apiRoute,
  HttpError,
  json,
  parseUuid,
  readJsonObject,
  requireUserClient,
  type RouteParameters,
} from '../../../../../src/server/api';
import { withEventPlaces } from '../../../../../src/server/eventPlaces';
import { SupabaseError } from '../../../../../src/server/supabase';
import { packageNotificationValues } from '../../../../../src/server/validation';

interface PackageParameters extends RouteParameters {
  id: string;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const PATCH = apiRoute<PackageParameters>(async (context) => {
  const { id } = await context.route.params;
  const packageId = parseUuid(id, 'package id');
  const { muted, emailMuted } = packageNotificationValues(await readJsonObject(context.request));
  const client = requireUserClient(context);
  try {
    if (muted !== undefined) await client.updatePackage(packageId, { notifications_muted: muted });
    if (emailMuted !== undefined) await client.updatePackage(packageId, { email_muted: emailMuted });
  } catch (error) {
    if (error instanceof SupabaseError && error.status === 404) {
      throw new HttpError(404, 'Package not found', undefined, { cause: error });
    }
    throw error;
  }
  const parcel = await client.getPackage(packageId);
  if (!parcel) throw new HttpError(404, 'Package not found');
  return json(withEventPlaces(parcel));
}, { serviceRequired: true });
