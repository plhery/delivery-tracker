import { apiRoute, json, readJsonObject, requireService, requireUser } from '../../../../src/server/api';
import { claimAccountTracking } from '../../../../src/server/accountTrackingBudget';
import { detectCarrier } from '../../../../src/server/carrierDetection';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = apiRoute(
  async (context) => json(await detectCarrier(await readJsonObject(context.request), () =>
    claimAccountTracking(requireService(context), requireUser(context).id, 'detection'))),
  { serviceRequired: true },
);
