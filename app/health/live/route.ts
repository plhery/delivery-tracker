import { apiRoute, json, noContent } from '../../../src/server/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiRoute(async () => json({ ok: true }), { authenticated: false, loadService: false });
export const HEAD = apiRoute(async () => noContent(200), { authenticated: false, loadService: false });
