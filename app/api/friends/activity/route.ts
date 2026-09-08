import { apiRoute, json, requireUserClient } from '../../../../src/server/api';
import { friendsActivity } from '../../../../src/server/friends';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiRoute(async (context) => json(friendsActivity(
  await requireUserClient(context).request('/rest/v1/rpc/friends_activity', { method: 'POST', body: {} }),
)), { loadService: false });
