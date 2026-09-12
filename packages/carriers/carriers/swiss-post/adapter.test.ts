import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../core/errors';
import type { JsonObject } from '../../core/types';
import { parseSwissPostShipment, SwissPostTracker } from './adapter';
import { EVENT_STAGE_BY_CODE, LETTER_IMPORT_STAGE_BY_CODE, swissPostEventStage } from './status';

const WRONG_SWISS_POST_NUMBER = '989999999999999999';

interface ShipmentFixture {
  shipment: JsonObject;
  events: unknown[];
  translations: Record<string, string>;
}

const outForDelivery = (): ShipmentFixture => JSON.parse(
  readFileSync(new URL('./fixtures/out-for-delivery.json', import.meta.url), 'utf8'),
) as ShipmentFixture;
const capabilities = (JSON.parse(
  readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
) as { capabilities: string[] }).capabilities;

function mockSearchResult(items: unknown): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({
      userIdentifier: 'unit-test-user',
    }), { headers: { 'x-csrf-token': 'unit-test-csrf' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ hash: 'unit-test-hash' })))
    .mockResolvedValueOnce(new Response(JSON.stringify(items)));
}

afterEach(() => vi.restoreAllMocks());

describe('Swiss Post historical event codes', () => {
  it('retains the exact international barcode supplied by the carrier', () => {
    expect(parseSwissPostShipment({ globalStatus: 'TO_BE_DELIVERED', internationalBarcode: '12345678901' }, []))
      .toMatchObject({ international_tracking_number: '12345678901' });
    expect(parseSwissPostShipment({ globalStatus: 'TO_BE_DELIVERED', internationalBarcode: null }, []))
      .not.toHaveProperty('international_tracking_number');
  });

  it.each([
    ['620', 'Consignment recorded by the foreign sender (data delivered)', 'registered'],
    ['803', 'Customs clearance process underway', 'customs'],
    ['804', 'Completion of customs clearance process', 'in_transit'],
    ['805', 'Completion of customs clearance process', 'in_transit'],
    ['818', 'Arrival in destination country', 'in_transit'],
    ['912', 'Time at which your consignment was mailed', 'accepted'],
    ['915', 'The consignment has left the border point', 'in_transit'],
    ['1001', 'Arrival at the collection/delivery point', 'in_transit'],
    ['1213', 'Sorted for delivery', 'in_transit'],
    ['1218', 'Sorted for delivery', 'in_transit'],
  ])('classifies international postal handoff scan %s from its code', (code, description, stage) => {
    expect(LETTER_IMPORT_STAGE_BY_CODE[code]).toBe(stage);
    expect(swissPostEventStage(`LETTER.*.90.${code}`)).toBe(stage);
    const result = parseSwissPostShipment({ globalStatus: 'TO_BE_DELIVERED' }, [
      { eventCode: `LETTER.*.90.${code}`, timestamp: '2026-09-10T07:00:00+02:00', externalMetadata: { description } },
    ]);
    expect(result.current_stage).toBe(stage);
    expect(result.events?.[0]).toMatchObject({ description, stage });
  });

  it('uses the parcel table outside the LETTER import range', () => {
    expect(swissPostEventStage('PARCEL.*.1.1003')).toBe(EVENT_STAGE_BY_CODE['1003']);
    expect(swissPostEventStage('LETTER.*.1.803')).toBeUndefined();
    expect(swissPostEventStage('PARCEL.*.1.9999')).toBeUndefined();
  });

  it('keeps forwarding scans in transit after loading onto the delivery vehicle', () => {
    const result = parseSwissPostShipment({ globalStatus: 'IN_DELIVERY' }, [
      { eventCode: 'PARCEL.*.2.820', timestamp: '2026-09-01T05:00:00+02:00' },
      { eventCode: 'PARCEL.*.1.1003', timestamp: '2026-09-01T08:00:00+02:00' },
    ]);
    expect(result.current_stage).toBe('out_for_delivery');
    expect(result.events?.map((event) => event.stage)).toEqual(['out_for_delivery', 'in_transit']);
  });

  it('keeps a MyPost24 deposit ready for pickup even if the carrier summary says delivered', () => {
    const result = parseSwissPostShipment({ globalStatus: 'DELIVERED' }, [
      { eventCode: 'PARCEL.*.1.2102', timestamp: '2026-09-01T08:00:00+02:00' },
    ], { 'PARCEL.*.1.2102.INLAND': 'Deposited in the MyPost24 machine' });
    expect(result).toMatchObject({
      status: 'in_transit', current_stage: 'ready_for_pickup',
      events: [{ stage: 'ready_for_pickup' }],
    });
  });
});

describe('Swiss Post projection', () => {
  it('covers every capability declared in carrier.json', () => {
    expect(capabilities).toEqual(['history', 'location', 'eta', 'provider_code']);
    const { shipment, events, translations } = outForDelivery();
    const result = parseSwissPostShipment(shipment, events, translations);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some((event) => event.location)).toBe(true);
    expect(result.events?.some((event) => event.provider_code)).toBe(true);
    expect(result.expected_delivery).toBe('2026-09-12 09:00–12:00');
    expect(result).toMatchObject({
      status: 'out_for_delivery',
      current_stage: 'out_for_delivery',
      last_status_text: 'Loading into delivery vehicle',
      canonical_tracking_number: '993412345612345678',
      international_tracking_number: 'RA123456785CH',
      timezone: 'Europe/Zurich',
    });
  });

  it('discards the recipient, address, signature and contact fields', () => {
    const { shipment, events, translations } = outForDelivery();
    const serialized = JSON.stringify(parseSwissPostShipment(shipment, events, translations));
    for (const privateValue of [
      'PRIVATE RECIPIENT',
      'PRIVATE STREET 7',
      'PRIVATE SIGNATURE',
      'private@example.test',
      'private-summary-id',
    ]) expect(serialized).not.toContain(privateValue);
  });
});

describe('Swiss Post no-data response', () => {
  it('runs the anonymous search flow and maps an empty result to a clean 404', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        userIdentifier: '<[anonymous]>unit-test-user',
      }), {
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': 'unit-test-csrf',
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ hash: 'unit-test-hash' }), {
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('[]', {
        headers: { 'Content-Type': 'application/json' },
      }));

    await expect(new SwissPostTracker().fetch(WRONG_SWISS_POST_NUMBER))
      .rejects.toBeInstanceOf(NotFoundError);

    expect(fetcher).toHaveBeenCalledTimes(3);
    const historyRequest = fetcher.mock.calls[1]!;
    expect(String(historyRequest[0])).toContain('/ekp-web/api/history?userId=');
    expect(historyRequest[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ searchQuery: WRONG_SWISS_POST_NUMBER }),
    });
    expect(String(fetcher.mock.calls[2]?.[0])).toContain('/history/not-included/unit-test-hash?');
  });

  it('keeps malformed non-array results distinct from no data', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ userIdentifier: 'unit-test-user' }), {
        headers: { 'x-csrf-token': 'unit-test-csrf' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ hash: 'unit-test-hash' })))
      .mockResolvedValueOnce(new Response('{}'));

    await expect(new SwissPostTracker().fetch(WRONG_SWISS_POST_NUMBER))
      .rejects.toThrow('Swiss Post returned an invalid shipment response');
  });

  it('selects the matching shipment rather than accepting the first result', async () => {
    const fetcher = mockSearchResult([
      { shipmentNumber: 'OTHER-SHIPMENT-ID', globalStatus: 'DELIVERED' },
      { shipmentNumber: '989.999.999.999.999.999', globalStatus: 'REGISTERED' },
    ]);

    await expect(new SwissPostTracker().fetch(WRONG_SWISS_POST_NUMBER)).resolves.toMatchObject({
      status: 'pending',
      global_status: 'REGISTERED',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('resolves an exact international barcode to the domestic delivery number', async () => {
    mockSearchResult([{ shipmentNumber: WRONG_SWISS_POST_NUMBER, internationalBarcode: '12345678901', globalStatus: 'IN_DELIVERY' }]);
    await expect(new SwissPostTracker().fetch('12345678901')).resolves.toMatchObject({
      status: 'out_for_delivery', canonical_tracking_number: WRONG_SWISS_POST_NUMBER,
      international_tracking_number: '12345678901',
    });
  });

  it('rejects ambiguous international references even when one domestic number matches', async () => {
    mockSearchResult([
      { shipmentNumber: WRONG_SWISS_POST_NUMBER, globalStatus: 'IN_DELIVERY' },
      { shipmentNumber: '990000000000000001', internationalBarcode: WRONG_SWISS_POST_NUMBER, globalStatus: 'DELIVERED' },
    ]);
    await expect(new SwissPostTracker().fetch(WRONG_SWISS_POST_NUMBER)).rejects.toThrow('ambiguous shipment');
  });

  it('rejects mismatched and non-identifying result arrays', async () => {
    mockSearchResult([{ shipmentNumber: 'OTHER-SHIPMENT-ID', globalStatus: 'DELIVERED' }]);
    await expect(new SwissPostTracker().fetch(WRONG_SWISS_POST_NUMBER))
      .rejects.toThrow('Swiss Post returned a different shipment');

    vi.restoreAllMocks();
    mockSearchResult([{ identity: 'private-summary-id', globalStatus: 'REGISTERED' }]);
    await expect(new SwissPostTracker().fetch(WRONG_SWISS_POST_NUMBER))
      .rejects.toThrow('Swiss Post did not return a shipment identifier');
  });
});
