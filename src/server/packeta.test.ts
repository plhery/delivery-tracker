import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizePacketaTrackingNumber,
  packetaTrackingUrl,
  parsePacketaTrackingResponse,
  PacketaTracker,
  PacketaTrackingError,
} from './packeta';
import { buildEvents } from './trackingSync';

// All identifiers, timestamps and names below are synthetic. Event sentences use
// the real canned English wording confirmed live by the prior-art client
// (ha-packeta tests/payloads.py), so substring classification exercises production
// text rather than paraphrases.
const TRACKING_NUMBER = 'Z1234567890';

function packet(overrides: Record<string, unknown> = {}) {
  return {
    barcode: TRACKING_NUMBER,
    packetStatusId: '3',
    packetStatus: 'The package has been delivered',
    sender: 'Example Sender s.r.o.',
    branchAddress: 'Example Pickup Point, Example Street 1',
    trackingDetails: [
      { text: 'We are aware of your parcel and are waiting for the sender to hand it over to us.', time: '2026-01-05 08:00:00' },
      { text: 'The parcel is currently on its way to the depot.', time: '2026-01-06 15:30:00' },
      { text: 'The parcel is ready for pickup. Z-BOX Central 5', time: '2026-07-07 09:00:00' },
      { text: 'The parcel is with you. Thank you, and we look forward to next time.', time: '2026-07-07 13:00:00' },
    ],
    ...overrides,
  };
}

function response(value: unknown, status = 200) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('Packeta tracking normalization', () => {
  it('accepts the Z barcode case-insensitively and rejects other shapes', () => {
    expect(normalizePacketaTrackingNumber('z1234567890')).toBe(TRACKING_NUMBER);
    expect(normalizePacketaTrackingNumber('Z1234567890')).toBe(TRACKING_NUMBER);
    for (const raw of ['1234567890', 'Z123456789', 'Z12345678901', 'ZA234567890', '']) {
      expect(() => normalizePacketaTrackingNumber(raw)).toThrow(TypeError);
    }
    expect(packetaTrackingUrl(TRACKING_NUMBER)).toBe('https://tracking.packeta.com/en/Z1234567890');
  });
});

describe('Packeta response parsing', () => {
  it('returns delivered history newest-first with Prague timestamps', () => {
    const result = parsePacketaTrackingResponse({ item: packet() }, TRACKING_NUMBER);
    expect(result).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'The package has been delivered',
      last_update: '2026-07-07T13:00:00+02:00',
      expected_delivery: null,
      timezone: 'Europe/Prague',
    });
    expect(result.events?.map((event) => [(event.description ?? '').slice(0, 24), event.stage, event.time])).toEqual([
      ['The parcel is with you. ', 'delivered', '2026-07-07T13:00:00+02:00'],
      ['The parcel is ready for ', 'ready_for_pickup', '2026-07-07T09:00:00+02:00'],
      ['The parcel is currently ', 'in_transit', '2026-01-06T15:30:00+01:00'],
      ['We are aware of your par', 'registered', '2026-01-05T08:00:00+01:00'],
    ]);
  });

  it('maps every documented packet status code', () => {
    const cases: Array<[string, string, string]> = [
      ['997', 'pending', 'registered'],
      ['1', 'in_transit', 'in_transit'],
      ['31', 'in_transit', 'in_transit'],
      ['2', 'out_for_delivery', 'ready_for_pickup'],
      ['3', 'delivered', 'delivered'],
      ['21', 'exception', 'failed_attempt'],
    ];
    for (const [code, status, stage] of cases) {
      const result = parsePacketaTrackingResponse({ item: packet({ packetStatusId: code }) }, TRACKING_NUMBER);
      expect(result).toMatchObject({ status, current_stage: stage });
    }
    expect(() => parsePacketaTrackingResponse({ item: packet({ packetStatusId: '999' }) }, TRACKING_NUMBER))
      .not.toThrow();
    expect(parsePacketaTrackingResponse({ item: packet({ packetStatusId: '999' }) }, TRACKING_NUMBER))
      .toMatchObject({ status: 'unknown' });
  });

  it('classifies event sentences and leaves unrecognized wording unstaged', () => {
    const result = parsePacketaTrackingResponse({ item: packet({
      packetStatusId: '31',
      trackingDetails: [
        { text: 'The parcel has been handed over to the carrier XYZ.', time: '2026-01-06 10:00:00' },
        { text: 'Something completely new happened.', time: '2026-01-06 11:00:00' },
      ],
    }) }, TRACKING_NUMBER);
    expect(result.events?.map((event) => event.stage)).toEqual([undefined, 'in_transit']);
    // The sync classifies the unmapped wording and records where the stage came from.
    expect(buildEvents({ id: 'parcel', carrier: 'packeta' }, result)[0]).toMatchObject({
      stage: 'in_transit',
      description: 'Something completely new happened.',
      raw_data: expect.objectContaining({ stage_source: 'none' }),
    });
  });

  it('binds the returned barcode to the requested shipment', () => {
    expect(() => parsePacketaTrackingResponse({ item: packet({ barcode: 'Z0987654321' }) }, TRACKING_NUMBER))
      .toThrow(RangeError);
    expect(() => parsePacketaTrackingResponse({ item: packet({ barcode: undefined }) }, TRACKING_NUMBER))
      .toThrow(TypeError);
  });

  it('treats a 200-carried error as not-found and an item-less 200 as schema drift', () => {
    expect(() => parsePacketaTrackingResponse({ error: 'notFound' }, TRACKING_NUMBER))
      .toThrow(PacketaTrackingError);
    expect(() => parsePacketaTrackingResponse({}, TRACKING_NUMBER)).toThrow(TypeError);
    expect(() => parsePacketaTrackingResponse(null, TRACKING_NUMBER)).toThrow(TypeError);
  });

  it('accepts a registered parcel without events and skips malformed rows', () => {
    const result = parsePacketaTrackingResponse({ item: packet({
      packetStatusId: '997',
      packetStatus: 'Registered',
      trackingDetails: [],
    }) }, TRACKING_NUMBER);
    expect(result).toMatchObject({ status: 'pending', current_stage: 'registered', events: [], last_update: null });
    const sparse = parsePacketaTrackingResponse({ item: packet({
      trackingDetails: [
        { text: 'The parcel is with you.', time: '2026-07-07 13:00:00' },
        { text: 'The parcel is with you.', time: '2026-07-07 13:00:00' },
        { text: '', time: '2026-07-07 13:00:00' },
        { text: 'The parcel is with you.', time: 'not a time' },
        'not a record',
      ],
    }) }, TRACKING_NUMBER);
    expect(sparse.events).toHaveLength(1);
  });

  it('retains operational sender and pickup-point names', () => {
    const result = parsePacketaTrackingResponse({ item: packet() }, TRACKING_NUMBER);
    expect(result).toMatchObject({
      sender_name: 'Example Sender s.r.o.',
      pickup_point: 'Example Pickup Point, Example Street 1',
      delivered_at: '2026-07-07T13:00:00+02:00',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('branchAddress');
  });
});

describe('PacketaTracker fetch', () => {
  it('posts the uppercased barcode and maps HTTP outcomes', async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      seen.push(String(input));
      return response({ item: packet() });
    });
    const result = await new PacketaTracker({ timeoutMs: 1_000 }).fetch('z1234567890');
    expect(result.status).toBe('delivered');
    expect(seen).toEqual(['https://tracking.packeta.com/api/getPacketById/Z1234567890/en']);
  });

  it('maps 404 and error-carrying 200 responses to not-found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ error: 'notFound' }, 404));
    await expect(new PacketaTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toMatchObject({ name: 'PacketaTrackingError', status: 404 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ error: 'notFound' }, 200));
    await expect(new PacketaTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toBeInstanceOf(PacketaTrackingError);
  });

  it('surfaces transport and schema failures distinctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({}, 500));
    await expect(new PacketaTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toMatchObject({ name: 'UpstreamHttpError', status: 500 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response('not json', 200));
    await expect(new PacketaTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toThrow(TypeError);
    expect(() => new PacketaTracker({ timeoutMs: 0 })).toThrow(TypeError);
    await expect(new PacketaTracker({ timeoutMs: 1_000 }).fetch('nope'))
      .rejects.toThrow(TypeError);
  });
});
