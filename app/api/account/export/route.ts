import {
  apiRoute,
  json,
  requireService,
  requireUser,
  requireUserClient,
} from '../../../../src/server/api';

import { withoutEventSources } from '../../../../src/server/eventPlaces';
import { friendsRPC, friendsSnapshot } from '../../../../src/server/friends';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiRoute(async (context) => {
  const user = requireUser(context);
  const client = requireUserClient(context);
  const snapshot = friendsSnapshot(await friendsRPC(client));
  const preferences = await client.getNotificationPreferences();
  return json({
    exportedAt: new Date().toISOString(),
    // When its apps last read its parcels is the server's to read: the account's own token cannot.
    account: { id: user.id, email: user.email, lastOpenedAt: await requireService(context).accountLastOpened(user.id) },
    friends: { profile: snapshot.profile, connections: snapshot.friends.map(({ id, nickname }) => ({ id, nickname })) },
    // The choice about the delivery email, and each email that was sent: for which parcel, and when.
    deliveryEmails: {
      enabled: typeof preferences.email_on_delivery === 'boolean' ? preferences.email_on_delivery : null,
      sent: await client.listDeliveryEmails(),
    },
    packages: (await client.listPackages(true)).map(withoutEventSources),
  }, 200, {
    'Content-Disposition': 'attachment; filename="peek-export.json"',
  });
}, { serviceRequired: true });
