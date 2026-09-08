import { analyticsConfiguration } from '../../../../src/server/analytics';

export const dynamic = 'force-dynamic';

export function GET() {
  // Public collection IDs only. Runtime configuration keeps forks and local demos off.
  return Response.json(analyticsConfiguration(), { headers: { 'Cache-Control': 'no-store' } });
}
