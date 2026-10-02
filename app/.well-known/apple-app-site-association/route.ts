import { appleAppSiteAssociation } from '../../../src/server/appleAppLinks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Read by Apple's servers, without credentials and without following redirects. */
export function GET(): Response {
  const association = appleAppSiteAssociation();
  if (!association) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return Response.json(association, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
