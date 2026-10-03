import {
  apiRoute,
  HttpError,
  json,
  readJsonObject,
  requireUser,
  requireUserClient,
} from '../../../../src/server/api';
import { emailAvailable } from '../../../../src/server/email/config';
import {
  notificationPreferences,
  notificationPreferencesResponse,
} from '../../../../src/server/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiRoute(async (context) => json(notificationPreferencesResponse(
  await requireUserClient(context).getNotificationPreferences(),
  emailAvailable(requireUser(context)),
)), { serviceRequired: true });

export const PATCH = apiRoute(async (context) => {
  const values = notificationPreferences(await readJsonObject(context.request));
  const available = emailAvailable(requireUser(context));
  // Switching the email off, or saving the rest, works whether or not the server can write to the account.
  if (values.emailOnDelivery === true && !available) {
    throw new HttpError(409, 'This server cannot email this account');
  }
  const row = await requireUserClient(context).setNotificationPreferences(
    values.enabledStages,
    values.quietHoursStart,
    values.quietHoursEnd,
    values.timezone,
    values.emailOnDelivery,
  );
  return json(notificationPreferencesResponse(row, available));
}, { serviceRequired: true });
