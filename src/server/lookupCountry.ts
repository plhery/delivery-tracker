import 'server-only';
import { isIP } from 'node:net';
import { captureOperationalError } from './observability';
import { HttpError } from './api';
import { SupabaseError, type SupabaseServiceClient } from './supabase';
import { isRecord, type JsonObject } from './types';

const names = new Intl.DisplayNames(['en'], { type: 'region' });
const groupedRegions = new Set(['EU', 'UN', 'QO', 'ZZ', 'XA', 'XB']);

export function normalizedLookupCountry(value: unknown): string | null {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(code) && !groupedRegions.has(code) && names.of(code) !== code ? code : null;
}

/** A weak country hint from the trusted Cloudflare edge, never a delivery destination. */
export function lookupCountry(request: Pick<Request, 'headers'>, deviceRegion?: unknown): string | null {
  if (deviceRegion != null) {
    const code = normalizedLookupCountry(deviceRegion);
    if (!code) throw new HttpError(400, 'Use a two-letter country code for the device region');
    return code;
  }
  if (process.env.TRUST_PROXY_HEADERS !== 'true' || !isIP(request.headers.get('cf-connecting-ip')?.trim() ?? '')) return null;
  return normalizedLookupCountry(request.headers.get('cf-ipcountry'));
}

/** Called only for a newly created parcel, before its first sync is queued. */
export async function rememberLookupCountry(service: SupabaseServiceClient, parcel: JsonObject, request: Pick<Request, 'headers'>, deviceRegion?: unknown): Promise<void> {
  const country = lookupCountry(request, deviceRegion);
  const data = { ...(isRecord(parcel.carrier_data) ? parcel.carrier_data : {}),
    add_recognition_pending: true, ...(country ? { lookup_country_hint: country } : {}) };
  try {
    await service.updatePackage(String(parcel.id), { carrier_data: data });
    parcel.carrier_data = data;
  } catch (error) {
    if (!(error instanceof SupabaseError)) throw error;
    captureOperationalError(error, { component: 'packages', operation: 'remember_lookup_country' });
  }
}
