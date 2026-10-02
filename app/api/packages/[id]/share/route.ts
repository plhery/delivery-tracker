import {
  apiRoute,
  HttpError,
  json,
  noContent,
  parseUuid,
  readJsonObject,
  requireUserClient,
  type ApiContext,
  type RouteParameters,
} from '../../../../../src/server/api';
import { recordParcelShare } from '../../../../../src/server/metrics';
import { SupabaseError, type ParcelShare } from '../../../../../src/server/supabase';
import { shareSwitches } from '../../../../../src/server/validation';
import type { ApiParcelShareResponse } from '../../../../../src/generated/apiContract';

interface PackageParameters extends RouteParameters {
  id: string;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Runs a sharing request under the caller's own token: the database checks
 * that the parcel is theirs. Someone else's parcel answers like none.
 */
async function ownParcel<Answer>(
  context: ApiContext<PackageParameters>,
  request: (packageId: string) => Promise<Answer>,
): Promise<Answer> {
  const packageId = parseUuid((await context.route.params).id, 'package id');
  try {
    return await request(packageId);
  } catch (error) {
    if (error instanceof SupabaseError && error.status === 404) {
      throw new HttpError(404, 'Package not found', undefined, { cause: error });
    }
    throw error;
  }
}

const shown = ({ id, showNumber, gift, createdAt }: ParcelShare) => ({
  link: { id, showNumber, gift, createdAt: new Date(createdAt).toISOString() },
}) satisfies ApiParcelShareResponse;

/** The link the account shares this parcel through, or null. */
export const GET = apiRoute<PackageParameters>(async (context) => {
  const client = requireUserClient(context);
  const share = await ownParcel(context, (packageId) => client.packageShare(packageId));
  return json(share ? shown(share) : { link: null } satisfies ApiParcelShareResponse);
}, { serviceRequired: true });

/**
 * Shares the parcel: makes its link when none is live, else changes what the
 * live one shows. The parcel's name is not stored with the link; the client
 * adds it to the address it copies, after #.
 */
export const PUT = apiRoute<PackageParameters>(async (context) => {
  const client = requireUserClient(context);
  const switches = shareSwitches(await readJsonObject(context.request), ['showNumber', 'gift'], true);
  const share = await ownParcel(context, (packageId) => client.sharePackage(packageId, switches));
  recordParcelShare('account', share.created ? 'started' : 'changed');
  return json(shown(share));
}, { serviceRequired: true });

/** Stops sharing: the link tells its visitors so for 30 days, and sharing again makes a new one. */
export const DELETE = apiRoute<PackageParameters>(async (context) => {
  const client = requireUserClient(context);
  if (await ownParcel(context, (packageId) => client.stopPackageShare(packageId))) recordParcelShare('account', 'stopped');
  return noContent();
}, { serviceRequired: true });
