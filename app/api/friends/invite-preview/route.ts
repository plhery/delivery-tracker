import { apiRoute, json, readJsonObject, requireService } from '../../../../src/server/api';
import { invitationPreview } from '../../../../src/server/friends';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = apiRoute(async (context) => json(
  await invitationPreview(requireService(context), await readJsonObject(context.request)),
), { authenticated: false, serviceRequired: true, publicRateLimit: { limit: 30, window: 60 } });
