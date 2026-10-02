import { apiRoute, json, readJsonObject } from '../../../../src/server/api';
import { detectCarrier } from '../../../../src/server/carrierDetection';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The front door detects the carrier before anyone signs in.
export const POST = apiRoute(
  async ({ request }) => json(await detectCarrier(await readJsonObject(request))),
  { authenticated: false, loadService: false, publicRateLimit: { limit: 20, window: 60 } },
);
