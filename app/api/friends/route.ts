import { apiRoute, json, readJsonObject, requireUserClient } from '../../../src/server/api';
import { friendsAction, friendsActionResponse, friendsRPC, friendsSnapshot } from '../../../src/server/friends';
import { wakeFriendshipWorker } from '../../../src/server/background';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiRoute(async (context) => json(
  friendsSnapshot(await friendsRPC(requireUserClient(context))),
), { loadService: false });

export const POST = apiRoute(async (context) => {
  const action = friendsAction(await readJsonObject(context.request));
  const result = friendsActionResponse(await friendsRPC(requireUserClient(context), action), action.action);
  if (action.action === 'accept_invite') wakeFriendshipWorker();
  return json(result);
}, { loadService: false });
