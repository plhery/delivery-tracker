import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult, type CarrierResult } from '../../core/result';
import { CainiaoTracker, fetchCainiao, parseCainiaoTrackingResponse } from './adapter';

const folder = path.dirname(fileURLToPath(import.meta.url));
const carrier = JSON.parse(
  readFileSync(path.join(folder, 'carrier.json'), 'utf8'),
) as { capabilities: string[] };

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(folder, 'fixtures', name), 'utf8'));
}

const CAINIAO_WRONG_NUMBER = 'LP00000000000000';

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Cainiao wrong-number handling', () => {
  it('maps a matching empty external module to a privacy-safe 404', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      module: [{
        mailNo: CAINIAO_WRONG_NUMBER,
        mailNoSource: 'EXTERNAL',
        detailList: [],
        privateMessage: 'Private upstream details',
      }],
      success: true,
    }));

    try {
      await fetchCainiao(CAINIAO_WRONG_NUMBER);
      throw new Error('Expected the lookup to fail');
    } catch (error) {
      expect(error).toMatchObject({ name: 'NotFoundError', status: 404, kind: 'not_found' });
      expect(String(error)).toContain('Cainiao could not locate the shipment');
      expect(String(error)).not.toContain('Private upstream details');
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    const requested = new URL(String(fetcher.mock.calls[0]![0]));
    expect(requested.searchParams.get('mailNos')).toBe(CAINIAO_WRONG_NUMBER);
  });

  it('keeps a matching non-external empty shipment pending', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      module: [{
        mailNo: CAINIAO_WRONG_NUMBER,
        mailNoSource: 'INTERNAL',
        detailList: [],
      }],
      success: true,
    }));

    await expect(fetchCainiao(CAINIAO_WRONG_NUMBER)).resolves.toMatchObject({
      status: 'pending',
      last_status_text: '',
      events: [],
    });
  });

  it('rejects a response describing a different shipment', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      module: [{ mailNo: 'LP11111111111111', detailList: [] }],
      success: true,
    }));

    await expect(fetchCainiao(CAINIAO_WRONG_NUMBER)).rejects.toThrow('different shipment');
  });

  it('uses the environment fetcher the factory hands the tracker', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      module: [{ mailNo: CAINIAO_WRONG_NUMBER, mailNoSource: 'INTERNAL', detailList: [] }],
    }));
    const global = vi.spyOn(globalThis, 'fetch');

    await expect(new CainiaoTracker({ fetcher }).fetch(CAINIAO_WRONG_NUMBER))
      .resolves.toMatchObject({ status: 'pending' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(global).not.toHaveBeenCalled();
  });
});

describe('Cainiao projection', () => {
  const delivered = parseCainiaoTrackingResponse(fixture('delivered.json'), 'LP00000000000001');
  const inTransit = parseCainiaoTrackingResponse(fixture('in-transit.json'), 'LP00000000000002');

  it('keeps the whole delivered journey and the partner handoff number', () => {
    expect(delivered).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Delivered',
      last_update: '2026-03-04T10:15:00+01:00',
      // A delivered parcel has no estimate left to show.
      expected_delivery: null,
      delivered_at: '2026-03-04T10:15:00+01:00',
      delivery_tracking_number: 'RA123456785CH',
    });
    expect(delivered.events?.map((event) => [event.description, event.stage])).toEqual([
      ['Delivered', 'delivered'],
      ['Out for delivery', 'out_for_delivery'],
      ['Import customs clearance success', 'in_transit'],
      ['Shipment accepted by the warehouse', 'registered'],
    ]);
  });

  it('reads each scan at its own GMT offset and ignores the Beijing-based epoch', () => {
    // The fixture's epoch `time` values read timeStr as GMT+8, as the live API does.
    expect(delivered.events?.map((event) => event.time)).toEqual([
      '2026-03-04T10:15:00+01:00', '2026-03-04T07:02:00+01:00', '2026-03-02T19:40:00+01:00', '2026-02-25T09:00:00+08:00',
    ]);
    const scan = (timeZone?: string) => parseCainiaoTrackingResponse({ module: [{ mailNo: 'LP00000000000001',
      latestTrace: { actionCode: 'LH_ARRIVE', timeStr: '2026-06-10 07:40:00', timeZone, time: 1781048400000 }, detailList: [],
    }] }, 'LP00000000000001').last_update;
    expect(scan('GMT+5:30')).toBe('2026-06-10T07:40:00+05:30');
    expect(scan('GMT-5')).toBe('2026-06-10T07:40:00-05:00');
    expect(scan('GMT')).toBe('2026-06-10T07:40:00Z');
    // Without a zone the wall clock stays text rather than becoming the epoch's instant.
    expect(scan(undefined)).toBe('2026-06-10 07:40:00');
  });

  it.each(['ra 123.456-785 ch', 'RA123456785CH'])('normalizes the machine-readable partner reference before host validation: %s', (reference) => {
    const result = normalizeCarrierResult(parseCainiaoTrackingResponse({ module: [{ mailNo: 'LP00000000000001',
      copyRealMailNo: reference, latestTrace: { actionCode: 'LH_ARRIVE' }, detailList: [],
    }] }, 'LP00000000000001'));
    expect(result.delivery_tracking_number).toBe('RA123456785CH');
    expect(result.delivery_carrier).toBeUndefined();
  });

  it('uses display prose only when the machine-readable reference is invalid', () => {
    const result = normalizeCarrierResult(parseCainiaoTrackingResponse({ module: [{ mailNo: 'LP00000000000001',
      copyRealMailNo: 'bad?number', realMailNo: 'Handover reference: ra123456785ch', detailList: [],
    }] }, 'LP00000000000001'));
    expect(result.delivery_tracking_number).toBe('RA123456785CH');
  });

  it('reports the estimate as a window while the parcel is still moving', () => {
    expect(inTransit).toMatchObject({
      status: 'in_transit',
      current_stage: 'in_transit',
      expected_delivery: '2026-03-12',
      expected_delivery_from: '2026-03-10',
    });
  });

  it('never reads a station signature as a delivery', () => {
    const result = parseCainiaoTrackingResponse({
      module: [{
        mailNo: 'LP00000000000003',
        latestTrace: { actionCode: 'GTMS_STA_SIGNED', standerdDesc: 'Arrived at the pickup station' },
        detailList: [{ actionCode: 'GTMS_STA_SIGNED', standerdDesc: 'Arrived at the pickup station' }],
      }],
    }, 'LP00000000000003');

    expect(result).toMatchObject({ status: 'out_for_delivery', current_stage: 'ready_for_pickup' });
    expect(result.events?.[0]?.stage).toBe('ready_for_pickup');
  });
});

describe('Cainiao declared capabilities and privacy', () => {
  const results: CarrierResult[] = [
    parseCainiaoTrackingResponse(fixture('delivered.json'), 'LP00000000000001'),
    parseCainiaoTrackingResponse(fixture('in-transit.json'), 'LP00000000000002'),
  ];
  const checks: Record<string, (result: CarrierResult) => boolean> = {
    history: (result) => (result.events?.length ?? 0) > 0,
    location: (result) => (result.events ?? []).some((event) => Boolean(event.location)),
    eta: (result) => Boolean(result.expected_delivery),
    eta_window: (result) => Boolean(result.expected_delivery_from),
    sender_name: (result) => Boolean(result.sender_name),
    pickup_point: (result) => Boolean(result.pickup_point),
    weight: (result) => result.weight_kg != null,
    dimensions: (result) => Boolean(result.dimensions_text),
    delivered_at: (result) => Boolean(result.delivered_at),
    provider_code: (result) => (result.events ?? []).some((event) => Boolean(event.provider_code)),
  };

  it.each(carrier.capabilities)('declares %s and a fixture proves it', (capability) => {
    const check = checks[capability];
    expect(check, `unknown capability ${capability}`).toBeTypeOf('function');
    expect(results.some((result) => check!(result))).toBe(true);
  });

  it('drops the recipient identity the module carries', () => {
    const projected = JSON.stringify(results[0]);
    for (const value of ['Made Up Recipient', 'Example Street 1', 'proof-of-delivery', 'signPictureUrl']) {
      expect(projected).not.toContain(value);
    }
  });
});
