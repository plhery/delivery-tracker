import { timingSafeEqual } from 'node:crypto';
import { apiRoute } from '../../../src/server/api';
import { metricsContentType, metricsText, metricsToken } from '../../../src/server/metrics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(header: string | null, token: string): boolean {
  const presented = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!presented || presented.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(token));
}

/**
 * Prometheus scrape endpoint for carrier telemetry. Closed unless
 * METRICS_TOKEN is configured; the token travels as a bearer token from the
 * scraper. Series carry carrier ids, step ids and error classes only.
 */
export const GET = apiRoute(
  async ({ request }) => {
    const token = metricsToken();
    if (!token) return new Response(null, { status: 404 });
    if (!authorized(request.headers.get('authorization'), token)) {
      return new Response(null, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
    }
    return new Response(await metricsText(), {
      headers: { 'Content-Type': metricsContentType, 'Cache-Control': 'no-store' },
    });
  },
  { authenticated: false, loadService: false, publicRateLimit: { limit: 120, window: 60 } },
);
