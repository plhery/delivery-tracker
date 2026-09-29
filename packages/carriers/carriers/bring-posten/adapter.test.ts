import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { BringTracker } from './adapter';
import { normalizeBringNumber, parseBring } from './parser';
import { bringStatus } from './status';

const NUMBER = '00000000000000001';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));
const payload = () => structuredClone(fixture);
const parcel = (value: ReturnType<typeof payload>) => value.consignmentWithDomainAsync.packageSet[0];
const latest = (value: ReturnType<typeof payload>, changes: Record<string, unknown>) => {
  Object.assign(parcel(value).eventSet[0], changes);
  Object.assign(parcel(value).domain.latestSignificantEvent, changes);
};

describe('Bring consumer parcel projection', () => {
  it('binds both consignment and S10 queries, preserves units and excludes personal fields', () => {
    const result = normalizeCarrierResult(parseBring(payload(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_update: '2026-01-06T12:00:00+01:00',
      delivered_at: '2026-01-06T12:00:00+01:00', expected_delivery: null, weight_kg: 0.5, dimensions_text: '20 × 15 × 4 cm' });
    expect(result.events?.map(event => event.stage)).toEqual(['delivered', 'out_for_delivery', 'ready_for_pickup', 'accepted', 'registered']);
    expect(parseBring(payload(), 'RR000000005NO').events).toEqual(result.events);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|description.*signature|Address|sender|recipient|pickup.code/);
    const declared = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    const evidence: Record<string, boolean> = { history: Boolean(result.events?.length), location: Boolean(result.events?.[0]?.location),
      delivered_at: Boolean(result.delivered_at), weight: Boolean(result.weight_kg), dimensions: Boolean(result.dimensions_text) };
    for (const capability of declared.capabilities) expect(evidence[capability], capability).toBe(true);
  });

  it('rejects wrong identities, unbound aliases, unknown brands and multiple pieces', () => {
    const wrong = payload(); wrong.consignmentWithDomainAsync.consignmentId = '00000000000000002';
    const unknown = payload(); parcel(unknown).brand = 'UNDEFINED';
    const malformed = payload(); parcel(malformed).brand = ['POSTEN'];
    for (const value of [wrong, unknown, malformed]) expect(() => parseBring(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    for (const change of [{ numberOfConsignmentItems: 2 }, { packageSet: [] }, { domain: { isMultiParcel: true } }]) {
      const value = payload(); Object.assign(value.consignmentWithDomainAsync, change);
      expect(() => parseBring(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    }
    const duplicate = payload(); duplicate.consignmentWithDomainAsync.packageSet.push(parcel(duplicate));
    expect(() => parseBring(duplicate, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
  });

  it('keeps notifications in history while current progress follows the significant scan', () => {
    const value = payload(); parcel(value).eventSet.unshift({ status: 'NOTIFICATION_SENT', description: 'PRIVATE phone',
      dateIso: '2026-01-07T12:00:00+01:00', insignificant: true, lmEventCode: 'N', city: '' });
    const result = parseBring(value, NUMBER);
    expect(result.last_update).toBe('2026-01-06T12:00:00+01:00'); expect(result.status).toBe('delivered');
    expect(result.events?.[0]).toMatchObject({ provider_code: 'NOTIFICATION_SENT', description: 'Notification sent' });
    expect(result.events?.[0]).not.toHaveProperty('stage');
  });

  it('requires the selected current scan to match the summary and rejects terminal conflicts', () => {
    for (const changes of [{ status: 'IN_TRANSIT' }, { dateIso: '2026-01-07T12:00:00+01:00' },
      { city: 'Other City' }, { insignificant: true }, { lmEventCode: 'X' }]) {
      const value = payload(); Object.assign(parcel(value).domain.latestSignificantEvent, changes);
      expect(() => parseBring(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    }
    const value = payload(); parcel(value).domain.currentStatus = 'EN_ROUTE';
    expect(() => parseBring(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    latest(value, { status: 'IN_TRANSIT' }); parcel(value).domain.currentStatus = 'DELIVERED';
    expect(() => parseBring(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
  });

  it('distinguishes return transport and returned delivery without trusting a return flag alone', () => {
    const value = payload(); latest(value, { status: 'RETURN' }); parcel(value).domain.currentStatus = 'EN_ROUTE_RETURN';
    parcel(value).domain.returnData.isReturned = true;
    expect(parseBring(value, NUMBER)).toMatchObject({ status: 'in_transit', current_stage: 'in_transit' });
    expect(parseBring(value, NUMBER)).not.toHaveProperty('delivered_at');
    latest(value, { status: 'DELIVERED_SENDER' }); parcel(value).domain.currentStatus = 'DELIVERED_RETURN';
    expect(parseBring(value, NUMBER)).toMatchObject({ status: 'exception', current_stage: 'returned' });
    expect(parseBring(value, NUMBER).events?.[0]).toMatchObject({ provider_leg: 'return', stage: 'returned' });
    expect(parseBring(value, NUMBER).events?.[1]).not.toHaveProperty('provider_leg');
  });

  it.each(['2026-02-30T12:00:00+01:00', '2026-01-06T24:00:00Z', '2026-01-06T12:00:00+02:99',
    '2026-01-06T12:00:00+15:00', '', null])('preserves an unresolved current clock %s', dateIso => {
    const value = payload(); latest(value, { dateIso });
    const result = parseBring(value, NUMBER);
    expect(result.status).toBe('delivered'); expect(result.last_update).toBeNull(); expect(result).not.toHaveProperty('delivered_at');
    expect(result.events?.[0]).not.toHaveProperty('time');
    if (dateIso) expect(result.events?.[0]).toMatchObject({ provider_time_text: dateIso });
  });

  it('retains offsetless clocks, unmapped statuses and exact duplicates safely', () => {
    const value = payload(); latest(value, { dateIso: '2026-01-06T12:00:00' });
    expect(parseBring(value, NUMBER)).toMatchObject({ last_update: null, last_update_local: '2026-01-06T12:00:00.000' });
    latest(value, { status: 'NEW_CODE' }); parcel(value).domain.currentStatus = 'UNKNOWN';
    expect(parseBring(value, NUMBER).status).toBe('unknown'); expect(bringStatus('constructor')).toBeUndefined();
    parcel(value).eventSet.push({ ...parcel(value).eventSet[0], description: 'PRIVATE alternate' });
    expect(parseBring(value, NUMBER).events).toHaveLength(5);
  });

  it('bounds schema and skips invalid measurements without dropping matching history', () => {
    for (const row of [null, {}, { status: 'DELIVERED', dateIso: 123, insignificant: false }]) {
      const value = payload(); parcel(value).eventSet.push(row);
      expect(() => parseBring(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    const value = payload(); parcel(value).eventSet = Array(501).fill(parcel(value).eventSet[0]);
    expect(() => parseBring(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    const units = payload(); parcel(units).weightInKgs = '0.5'; parcel(units).lengthInCm = -1;
    expect(parseBring(units, NUMBER)).not.toHaveProperty('weight_kg'); expect(parseBring(units, NUMBER)).not.toHaveProperty('dimensions_text');
    expect(() => parseBring({ errorState: 'NOT_FOUND', error: 'No shipments found' }, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
  });
});

describe('Bring bounded anonymous retrieval', () => {
  it('uses one current consumer JSON GET with no credentials', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload()));
    await new BringTracker({ fetcher }).fetch(NUMBER);
    expect(fetcher).toHaveBeenCalledOnce(); const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`https://sporing.bring.no/sporing/json/${NUMBER}?lang=en`);
    expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' });
    expect(new Headers(init?.headers).has('Authorization')).toBe(false); expect(new Headers(init?.headers).has('Cookie')).toBe(false);
  });

  it.each([[404, 'indeterminate'], [410, 'indeterminate'], [403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance']])('preserves HTTP %s semantics', async (status, kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Unavailable', { status: Number(status) }));
    await expect(new BringTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind }); expect(fetcher).toHaveBeenCalledOnce();
  });

  it('validates inputs, response bytes, cancellation and malformed JSON', async () => {
    for (const number of ['123', 'RR000000006NO', 'RR000000005CN', `${NUMBER}&secret=value`]) expect(() => normalizeBringNumber(number)).toThrow(TypeError);
    expect(normalizeBringNumber('rr 000000005 no')).toBe('RR000000005NO');
    const fetcher = vi.fn<typeof fetch>();
    await expect(new BringTracker({ fetcher }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
    const huge = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001)));
    await expect(new BringTracker({ fetcher: huge }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
    const invalid = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Unavailable</html>'));
    await expect(new BringTracker({ fetcher: invalid }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
  });
});
