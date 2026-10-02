import { analyticsConfigurationFor } from '../../../../src/server/analytics';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  // Public collection IDs only. Runtime configuration keeps forks and local demos off.
  return Response.json(analyticsConfigurationFor(request.headers), { headers: { 'Cache-Control': 'no-store' } });
}
