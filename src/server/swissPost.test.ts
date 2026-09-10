import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSwissPostShipment, SwissPostTracker, SwissPostTrackingError } from './swissPost';

const WRONG_SWISS_POST_NUMBER = '989999999999999999';

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
    const result = parseSwissPostShipment({ globalStatus: 'TO_BE_DELIVERED' }, [
      { eventCode: `LETTER.*.90.${code}`, timestamp: '2026-09-10T07:00:00+02:00', externalMetadata: { description } },
    ]);
    expect(result.current_stage).toBe(stage);
    expect(result.events?.[0]).toMatchObject({ description, stage });
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
      .rejects.toBeInstanceOf(SwissPostTrackingError);

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
