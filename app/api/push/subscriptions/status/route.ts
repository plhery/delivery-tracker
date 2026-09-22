import {
  apiRoute,
  json,
  readJsonObject,
  requireService,
  requireUser,
} from '../../../../../src/server/api';
import { pushEndpoint } from '../../../../../src/server/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// A browser keeps its subscription after the server removed or expired it, so
// only the server can say whether alerts still reach this device.
export const POST = apiRoute(async (context) => {
  const endpoint = pushEndpoint((await readJsonObject(context.request)).endpoint);
  const active = await requireService(context).hasActivePushSubscription(requireUser(context).id, endpoint);
  return json({ active });
}, { serviceRequired: true });
