import { apiRoute, json, noContent } from '../../src/server/api';
import { deliveryServiceReady } from '../../src/server/readiness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiRoute(async () => {
  const ok = await deliveryServiceReady();
  return json({ ok }, ok ? 200 : 503);
}, { authenticated: false, loadService: false });

export const HEAD = apiRoute(async () => {
  const ok = await deliveryServiceReady();
  return noContent(ok ? 200 : 503);
}, { authenticated: false, loadService: false });
