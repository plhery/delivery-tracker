import { apiRoute, json, readJsonObject, requireService, requireUser } from '../../../../src/server/api';
import { claimAccountTracking } from '../../../../src/server/accountTrackingBudget';
import { detectCarrier } from '../../../../src/server/carrierDetection';
import { lookupCountry } from '../../../../src/server/lookupCountry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = apiRoute(
  async (context) => {
    const body = await readJsonObject(context.request);
    return json(await detectCarrier(body, () =>
      claimAccountTracking(requireService(context), requireUser(context).id, 'detection'), context.request.signal, requireService(context),
    lookupCountry(context.request, body.lookupCountryHint)));
  },
  { serviceRequired: true },
);
