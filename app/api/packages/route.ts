import { verifyAmazonShippingAddition } from '../../../src/server/amazonShippingEligibility';
import { claimAccountTracking } from '../../../src/server/accountTrackingBudget';
import {
  apiRoute,
  HttpError,
  json,
  readJsonObject,
  requireService,
  requireUser,
  requireUserClient,
} from '../../../src/server/api';
import { withEventPlaces } from '../../../src/server/eventPlaces';
import { captureOperationalError } from '../../../src/server/observability';
import { SupabaseError } from '../../../src/server/supabase';
import { wakeSyncWorker } from '../../../src/server/background';
import { rememberLookupCountry } from '../../../src/server/lookupCountry';
import { newPackageValues } from '../../../src/server/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiRoute(async (context) => {
  const includeArchived = new URL(context.request.url).searchParams.get('includeArchived') === 'true';
  const client = requireUserClient(context);
  const [packages] = await Promise.all([
    client.listPackages(includeArchived),
    // The parcels are still readable when this fails; the next read records it.
    client.recordOpened().catch((error: unknown) => {
      if (!(error instanceof SupabaseError)) throw error;
      captureOperationalError(error, { component: 'packages', operation: 'record_account_opened' });
    }),
  ]);
  return json({ packages: packages.map(withEventPlaces) });
}, { serviceRequired: true });

export const POST = apiRoute(async (context) => {
  const values = newPackageValues(await readJsonObject(context.request));
  await claimAccountTracking(requireService(context), requireUser(context).id, 'lookup');
  await verifyAmazonShippingAddition(values.carrier, values.trackingNumber);
  const client = requireUserClient(context);
  const service = requireService(context);
  let parcel;
  try {
    parcel = await client.createPackage(
      values.trackingNumber,
      values.label,
      values.carrier,
      values.trackingUrl,
      values.dpdPostcode,
    );
  } catch (error) {
    if (error instanceof SupabaseError && error.code === 'P0001') {
      throw new HttpError(409, 'Your delivery box has reached its parcel limit', undefined, {
        cause: error,
      });
    }
    if (error instanceof SupabaseError && error.status === 409) {
      const existing = await client.getPackageByTrackingNumber(values.trackingNumber);
      return json({
        error: 'This tracking number is already in your delivery box',
        ...(typeof existing?.id === 'string' ? { packageId: existing.id } : {}),
      }, 409);
    }
    throw error;
  }

  await rememberLookupCountry(service, parcel, context.request);
  const jobIds: string[] = [];
  try {
    const job = await service.enqueueSyncJob({
      userId: requireUser(context).id,
      packageId: String(parcel.id),
    });
    wakeSyncWorker();
    if (typeof job.row.id === 'string') jobIds.push(job.row.id);
  } catch (error) {
    if (!(error instanceof SupabaseError)) throw error;
    await service.updatePackage(String(parcel.id), {
      sync_status: 'error',
      sync_error: 'The first tracking check could not be queued. Try again shortly.',
    });
  }
  return json({ package: parcel, jobIds }, 201);
}, { serviceRequired: true });
