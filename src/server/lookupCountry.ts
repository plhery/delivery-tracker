import 'server-only';
import { isIP } from 'node:net';
import { captureOperationalError } from './observability';
import { SupabaseError, type SupabaseServiceClient } from './supabase';
import { isRecord, type JsonObject } from './types';

const names = new Intl.DisplayNames(['en'], { type: 'region' });

/** A weak country hint from the trusted Cloudflare edge, never a delivery destination. */
export function lookupCountry(request: Pick<Request, 'headers'>): string | null {
  if (process.env.TRUST_PROXY_HEADERS !== 'true' || !isIP(request.headers.get('cf-connecting-ip')?.trim() ?? '')) return null;
  const code = request.headers.get('cf-ipcountry')?.trim().toUpperCase() ?? '';
  return /^[A-Z]{2}$/.test(code) && code !== 'ZZ' && names.of(code) !== code ? code : null;
}

/** Called only for a newly created parcel, before its first sync is queued. */
export async function rememberLookupCountry(service: SupabaseServiceClient, parcel: JsonObject, request: Pick<Request, 'headers'>): Promise<void> {
  const country = lookupCountry(request);
  if (!country) return;
  const data = { ...(isRecord(parcel.carrier_data) ? parcel.carrier_data : {}), lookup_country_hint: country };
  try {
    await service.updatePackage(String(parcel.id), { carrier_data: data });
    parcel.carrier_data = data;
  } catch (error) {
    if (!(error instanceof SupabaseError)) throw error;
    captureOperationalError(error, { component: 'packages', operation: 'remember_lookup_country' });
  }
}
