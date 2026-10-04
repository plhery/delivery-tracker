import 'server-only';
import { HttpError } from './api';
import { secondsUntilUtcMidnight } from './publicParcels';
import type { SupabaseServiceClient } from './supabase';

export async function claimAccountTracking(service: SupabaseServiceClient, userId: string, kind: 'lookup' | 'detection') {
  const configured = process.env[kind === 'lookup' ? 'ACCOUNT_LOOKUPS_PER_DAY' : 'ACCOUNT_DETECTIONS_PER_DAY'];
  const limit = configured && /^\d{1,6}$/.test(configured) ? Number(configured) : kind === 'lookup' ? 60 : 240;
  if (!await service.claimAccountTracking(userId, kind, limit)) {
    throw new HttpError(429, 'Today’s tracking allowance is used up. Try again tomorrow.', {
      'Retry-After': String(secondsUntilUtcMidnight(new Date())),
    });
  }
}
