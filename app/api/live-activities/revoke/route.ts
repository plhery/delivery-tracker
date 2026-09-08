import { createHash } from 'node:crypto';
import { apiRoute, json, readJsonObject, requireService } from '../../../../src/server/api';
import { deleteLiveActivityDevice, liveActivityRevocationToken } from '../../../../src/server/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = apiRoute(async (context) => {
  const payload = await readJsonObject(context.request);
  const { installationId } = deleteLiveActivityDevice(payload);
  const proof = liveActivityRevocationToken(payload.revocationToken);
  await requireService(context).revokeLiveActivityDevice(
    installationId, createHash('sha256').update(proof).digest('hex'),
  );
  return json({ ok: true });
}, { authenticated: false, serviceRequired: true, publicRateLimit: { limit: 60, window: 60 } });
