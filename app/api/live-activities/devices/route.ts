import { createHash } from 'node:crypto';
import {
  apiRoute,
  HttpError,
  json,
  readJsonObject,
  requireService,
  requireUser,
} from '../../../../src/server/api';
import { pushServices } from '../../../../src/server/push';
import {
  deleteLiveActivityDevice,
  liveActivityDevice,
} from '../../../../src/server/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = apiRoute(async (context) => {
  const service = requireService(context);
  if (!pushServices(service).liveActivities) {
    throw new HttpError(503, 'Live Activity push notifications are not configured');
  }
  const values = liveActivityDevice(await readJsonObject(context.request));
  const user = requireUser(context);
  if (!user.sessionId) throw new HttpError(401, 'A current sign-in session is required');
  await service.upsertLiveActivityDevice(
    user.id,
    values.installationId,
    values.token,
    values.environment,
    values.locale,
    user.sessionId,
    values.revocationToken ? createHash('sha256').update(values.revocationToken).digest('hex') : null,
  );
  return json({ ok: true }, 201);
}, { serviceRequired: true });

export const DELETE = apiRoute(async (context) => {
  const values = deleteLiveActivityDevice(await readJsonObject(context.request));
  await requireService(context).deleteLiveActivityDevice(
    requireUser(context).id,
    values.installationId,
  );
  return json({ ok: true });
}, { serviceRequired: true });
