import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupCountry, rememberLookupCountry } from './lookupCountry';
import * as observability from './observability';
import { SupabaseError, type SupabaseServiceClient } from './supabase';
import type { JsonObject } from './types';

const request = (country?: string, ip = '198.51.100.7') => ({ headers: new Headers({ 'cf-connecting-ip': ip, ...(country ? { 'cf-ipcountry': country } : {}) }) });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('lookup country hint', () => {
  it('uses only a recognized country from the trusted Cloudflare edge', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
    expect(lookupCountry(request(' fr '))).toBe('FR');
    expect(lookupCountry(request('CH', '2001:db8::7'))).toBe('CH');
    for (const country of [undefined, 'XX', 'T1', 'ZZ', 'France', 'FR,CH']) expect(lookupCountry(request(country))).toBeNull();
    expect(lookupCountry(request('FR', 'invalid'))).toBeNull();
    expect(lookupCountry({ headers: new Headers({ 'x-real-ip': '198.51.100.7', 'cf-ipcountry': 'FR' }) })).toBeNull();
    vi.stubEnv('TRUST_PROXY_HEADERS', 'false');
    expect(lookupCountry(request('FR'))).toBeNull();
  });

  it('persists only the country before queueing, without setting the destination or retaining the IP', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
    const updatePackage = vi.fn().mockResolvedValue(undefined);
    const service = { updatePackage } as unknown as SupabaseServiceClient;
    const parcel: JsonObject = { id: 'parcel', carrier_data: { routing: { version: 1 } } };
    await rememberLookupCountry(service, parcel, request('FR'));
    expect(updatePackage).toHaveBeenCalledExactlyOnceWith('parcel', { carrier_data: { routing: { version: 1 }, lookup_country_hint: 'FR', add_recognition_pending: true } });
    expect(JSON.stringify(parcel)).not.toContain('198.51.100.7');
    expect(parcel.carrier_data).not.toHaveProperty('destination_country');
  });

  it('prefers a valid device region without treating it as an IP-derived destination', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
    expect(lookupCountry(request('FR'), ' ch ')).toBe('CH');
    vi.stubEnv('TRUST_PROXY_HEADERS', 'false');
    expect(lookupCountry(request('FR'), 'DE')).toBe('DE');
    for (const region of ['ZZ', 'XX', 'EU', 'UN', 'QO', '001', 'France', 1, {}]) expect(() => lookupCountry(request('FR'), region)).toThrow();
  });

  it('marks a new addition even when it has no country hint', async () => {
    const updatePackage = vi.fn().mockResolvedValue(undefined);
    const parcel: JsonObject = { id: 'parcel', carrier_data: {} };
    await rememberLookupCountry({ updatePackage } as unknown as SupabaseServiceClient, parcel, request());
    expect(updatePackage).toHaveBeenCalledExactlyOnceWith('parcel', { carrier_data: { add_recognition_pending: true } });
  });

  it('continues without a hint when the optional persistence fails', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
    const report = vi.spyOn(observability, 'captureOperationalError').mockImplementation(() => null);
    const service = { updatePackage: vi.fn().mockRejectedValue(new SupabaseError('unavailable')) } as unknown as SupabaseServiceClient;
    const parcel: JsonObject = { id: 'parcel', carrier_data: {} };
    await rememberLookupCountry(service, parcel, request('FR'));
    expect(parcel.carrier_data).toEqual({});
    expect(report).toHaveBeenCalledOnce();
  });
});
