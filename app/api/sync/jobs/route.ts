import {
  apiRoute, HttpError, json, parseUuid, requireService, requireUser,
} from '../../../../src/server/api';
import { syncJobResponse } from '../../../../src/server/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiRoute(async (context) => {
  const rawIds = new URL(context.request.url).searchParams.getAll('ids');
  const ids = rawIds.length === 1 ? rawIds[0].split(',') : [];
  if (ids.length < 1 || ids.length > 20) {
    throw new HttpError(400, 'Request between 1 and 20 sync job ids');
  }
  const jobIds = [...new Set(ids.map((id) => parseUuid(id, 'sync job id').toLowerCase()))];
  const jobs = await requireService(context).getSyncJobs(jobIds, requireUser(context).id);
  // Never reveal whether an absent id exists for a different account.
  if (jobs.length !== jobIds.length) throw new HttpError(404, 'Sync job not found');
  return json({ jobs: jobs.map(syncJobResponse) });
}, { serviceRequired: true });
