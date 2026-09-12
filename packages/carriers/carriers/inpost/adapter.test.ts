import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SchemaError } from '../../core/errors';
import {
  normalizeInpostTrackingNumber,
  parseInpostTrackingResponse,
  InpostTracker,
} from './adapter';
import { classifyInpostStatus } from './status';

// All identifiers and timestamps below are synthetic. Status codes and the
// response shape follow the keyless inposteasy.com hub as documented by the
// prior-art client, live-confirmed on IT/PT/GB consignments 2026-08-31.
const TRACKING_NUMBER = '640000000000000000000001';
const DELIVERED = JSON.parse(
  readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const CAPABILITIES = (JSON.parse(
  readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
) as { capabilities: string[] }).capabilities;

function parcel(overrides: Record<string, unknown> = {}) {
  return { ...structuredClone(DELIVERED), ...overrides };
}

function response(value: unknown, status = 200) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('InPost tracking normalization', () => {
  it('accepts the detected InPost families case-insensitively and rejects the rest', () => {
    expect(normalizeInpostTrackingNumber('640000000000000000000001')).toBe(TRACKING_NUMBER);
    expect(normalizeInpostTrackingNumber('jjd0002233564270287')).toBe('JJD0002233564270287');
    expect(normalizeInpostTrackingNumber('8ydr098765432')).toBe('8YDR098765432');
    for (const raw of ['12345', 'Z8328162951', '']) {
      expect(() => normalizeInpostTrackingNumber(raw)).toThrow(TypeError);
    }
  });
});

describe('InPost response parsing', () => {
  it('returns delivered history newest-first with explicit offsets preserved', () => {
    const result = parseInpostTrackingResponse(parcel(), TRACKING_NUMBER);
    expect(result).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Delivered',
      last_update: '2026-05-04T10:00:00+02:00',
      expected_delivery: null,
    });
    expect(result.events?.map((event) => [event.description, event.stage, event.time])).toEqual([
      ['Delivered', 'delivered', '2026-05-04T10:00:00+02:00'],
      ['Ready for pickup', 'ready_for_pickup', '2026-05-03T09:00:00+02:00'],
      ['Moving', 'in_transit', '2026-05-02T12:00:00+02:00'],
      ['Registered', 'registered', '2026-05-01T08:00:00+02:00'],
    ]);
  });

  it('maps every documented public-hub status code', () => {
    const cases: Array<[string, string, string]> = [
      ['CRE.1001', 'pending', 'registered'],
      ['FMD.1001', 'pending', 'registered'],
      ['FMD.1002', 'in_transit', 'in_transit'],
      ['MMD.1003', 'in_transit', 'in_transit'],
      ['LMD.1002', 'in_transit', 'in_transit'],
      ['LMD.1005', 'out_for_delivery', 'ready_for_pickup'],
      ['LMD.9002', 'exception', 'failed_attempt'],
      ['LMD.9014', 'exception', 'returned'],
      ['EOL.1003', 'delivered', 'delivered'],
      ['EOL.9001', 'exception', 'failed_attempt'],
      ['RTS.1002', 'exception', 'returned'],
    ];
    for (const [code, status, stage] of cases) {
      expect(classifyInpostStatus(code)).toEqual({ status, stage });
      const result = parseInpostTrackingResponse(parcel({ status: code, trackingDetails: [] }), TRACKING_NUMBER);
      expect(result).toMatchObject({ status, current_stage: stage });
    }
  });

  it('reports unmapped codes as unknown with their raw wording preserved', () => {
    expect(classifyInpostStatus('NEW.9999')).toBeUndefined();
    const result = parseInpostTrackingResponse(parcel({
      status: 'NEW.9999',
      statusTitle: 'Something new',
      trackingDetails: [{ status: 'NEW.9999', statusTitle: 'Something new', datetime: '2026-05-04T10:00:00+02:00' }],
    }), TRACKING_NUMBER);
    expect(result).toMatchObject({ status: 'unknown', last_status_text: 'Something new' });
    // No explicit mapping means no stage at all: the sync classifies the raw
    // wording and records where the final stage came from.
    expect(result.events?.[0]).toMatchObject({ description: 'Something new' });
    expect(result.events?.[0]?.stage).toBeUndefined();
  });

  it('binds the returned tracking number to the requested shipment', () => {
    expect(() => parseInpostTrackingResponse(parcel({ trackingNumber: '640000000000000000000002' }), TRACKING_NUMBER))
      .toThrow(SchemaError);
    expect(() => parseInpostTrackingResponse(parcel({ trackingNumber: undefined }), TRACKING_NUMBER))
      .toThrow(SchemaError);
    expect(() => parseInpostTrackingResponse(null, TRACKING_NUMBER)).toThrow(SchemaError);
    expect(() => parseInpostTrackingResponse(parcel({ trackingDetails: {} }), TRACKING_NUMBER))
      .toThrow(SchemaError);
  });

  it('skips offset-less and malformed rows without losing the shipment', () => {
    const result = parseInpostTrackingResponse(parcel({
      trackingDetails: [
        { status: 'EOL.1001', statusTitle: 'Delivered', datetime: '2026-05-04 10:00:00' },
        { status: 'EOL.1001', statusTitle: 'Delivered', datetime: '2026-05-04T10:00:00+02:00' },
        { status: 'EOL.1001', statusTitle: 'Delivered', datetime: '2026-05-04T10:00:00+02:00' },
        { status: 'EOL.1001', statusTitle: '', datetime: '2026-05-04T10:00:00+02:00' },
        'not a record',
      ],
    }), TRACKING_NUMBER);
    // Empty description falls back to the code, so two rows survive the sparse input.
    expect(result.events?.map((event) => event.description)).toEqual(['Delivered', 'EOL.1001']);
  });

  it('never retains recipient identity, address or signature data', () => {
    const serialized = JSON.stringify(parseInpostTrackingResponse(parcel(), TRACKING_NUMBER));
    for (const secret of [
      'Example Recipient', 'Musterstrasse 1', '+490000000000', 'Example Signature',
      'receiverName', 'receiverAddress', 'receiverPhone', 'signature', 'countryCode',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('produces every capability carrier.json declares', () => {
    expect(CAPABILITIES).toEqual(['history']);
    expect(parseInpostTrackingResponse(parcel(), TRACKING_NUMBER).events?.length).toBeGreaterThan(0);
  });
});

describe('InpostTracker fetch', () => {
  it('gets the hub URL for the normalized number and maps HTTP outcomes', async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      seen.push(String(input));
      return response(parcel());
    });
    const result = await new InpostTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER);
    expect(result.status).toBe('delivered');
    expect(seen).toEqual([`https://inposteasy.com/api/tracking/${TRACKING_NUMBER}`]);
  });

  it('maps 404 to not-found and surfaces other failures distinctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ detail: 'not found' }, 404));
    await expect(new InpostTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toMatchObject({ name: 'NotFoundError', status: 404, message: 'InPost could not locate the shipment' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({}, 503));
    await expect(new InpostTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toMatchObject({ name: 'UpstreamHttpError', status: 503 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response('not json', 200));
    await expect(new InpostTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toThrow(TypeError);
    expect(() => new InpostTracker({ timeoutMs: 0 })).toThrow(TypeError);
    await expect(new InpostTracker({ timeoutMs: 1_000 }).fetch('nope'))
      .rejects.toThrow(TypeError);
  });
});
