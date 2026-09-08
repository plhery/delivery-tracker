import {
  apiRoute,
  json,
  requireUser,
  requireUserClient,
} from '../../../../src/server/api';

import { friendsRPC, friendsSnapshot } from '../../../../src/server/friends';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiRoute(async (context) => {
  const user = requireUser(context);
  const snapshot = friendsSnapshot(await friendsRPC(requireUserClient(context)));
  return json({
    exportedAt: new Date().toISOString(),
    account: { id: user.id, email: user.email },
    friends: { profile: snapshot.profile, connections: snapshot.friends.map(({ id, nickname }) => ({ id, nickname })) },
    packages: await requireUserClient(context).listPackages(true),
  }, 200, {
    'Content-Disposition': 'attachment; filename="delivery-tracker-export.json"',
  });
}, { loadService: false });
