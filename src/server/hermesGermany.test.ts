import { afterEach, describe, expect, it, vi } from 'vitest';
import { HermesGermanyTracker, parseHermesGermanyResponse } from './hermesGermany';

const NUMBER = 'H1234567890123456789';
// Synthetic payload in the shape observed on the public recipient service.
function fixture() {
  return [{
    barcode: NUMBER,
    address: { name: 'PRIVATE RECIPIENT', street: 'PRIVATE STREET' },
    atg: { companyName: 'Example Webshop GmbH' },
    parcelProgress: [
      { parcelStatus: 'ANNOUNCED', timestamp: '2026-09-01T12:00:00Z' },
      { parcelStatus: 'DELIVERED_NEIGHBOUR', timestamp: '2026-09-03T09:00:00Z', historyText: 'An Nachbarn zugestellt' },
      { parcelStatus: 'DELIVERY_TOUR_STARTED', timestamp: '2026-09-03T07:00:00Z' },
      { parcelStatus: 'DELIVERED_NEIGHBOUR', timestamp: '2026-09-03T09:00:00Z' },
    ],
  }];
}

afterEach(() => vi.restoreAllMocks());

describe('Hermes Germany', () => {
  it('orders and deduplicates real milestones, keeping display text but dropping address PII', () => {
    const result = parseHermesGermanyResponse(fixture(), NUMBER);
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', expected_delivery: null });
    expect(result.events?.map((event) => event.stage)).toEqual(['delivered', 'out_for_delivery', 'registered']);
    expect(JSON.stringify(result)).not.toContain('PRIVATE STREET');
    expect(result.events?.[0]?.description).toContain('Nachbarn');
    expect(result.last_update).toBe('2026-09-03T09:00:00.000Z');
  });

  it.each([
    ['ATG_OUT_OF_WAREHOUSE', 'registered'],
    ['RETURN_TO_SENDER', 'returned'],
    ['RETURN_DELIVERED_TO_SENDER', 'returned'],
    ['RETOURE_DELIVERED', 'returned'],
    ['DELIVERY_FAILED', 'failed_attempt'],
    ['READY_FOR_PICKUP', 'ready_for_pickup'],
  ])('does not confuse %s with delivery', (code, stage) => {
    const payload = [{ barcode: NUMBER, parcelProgress: [{ parcelStatus: code, timestamp: '2026-09-03T09:00:00Z' }] }];
    expect(parseHermesGermanyResponse(payload, NUMBER).current_stage).toBe(stage);
  });

  it('rejects missing, ambiguous, mismatched and malformed histories', () => {
    expect(() => parseHermesGermanyResponse({}, NUMBER)).toThrow('invalid tracking response');
    expect(() => parseHermesGermanyResponse([], NUMBER)).toThrow('could not locate');
    expect(() => parseHermesGermanyResponse(fixture(), 'H9999999999999999999')).toThrow('different');
    expect(() => parseHermesGermanyResponse([...fixture(), ...fixture()], NUMBER)).toThrow('ambiguous');
    for (const parcelProgress of [[], [null], [{ parcelStatus: 'ANNOUNCED', timestamp: 'nonsense' }]]) {
      expect(() => parseHermesGermanyResponse([{ barcode: NUMBER, parcelProgress }], NUMBER)).toThrow();
    }
    expect(parseHermesGermanyResponse([{ barcode: NUMBER, parcelProgress: [
      { parcelStatus: 'FUTURE_STATUS', timestamp: '2026-09-03T09:00:00Z' },
    ] }], NUMBER)).toMatchObject({ status: 'unknown' });
  });

  it('exposes sender and keeps unknown latest as unknown, not an error', () => {
    const result = parseHermesGermanyResponse(fixture(), NUMBER);
    expect(result).toMatchObject({ sender_name: 'Example Webshop GmbH', delivered_at: '2026-09-03T09:00:00.000Z' });
    const unknown = parseHermesGermanyResponse([{ barcode: NUMBER, parcelProgress: [
      { parcelStatus: 'FUTURE_STATUS', timestamp: '2026-09-03T09:00:00Z' },
    ] }], NUMBER);
    expect(unknown).toMatchObject({ status: 'unknown' });
  });

  it('only requests the public history and never the address endpoint', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(fixture())));
    await expect(new HermesGermanyTracker().fetch(NUMBER)).resolves.toMatchObject({ status: 'delivered' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(`https://api.my-deliveries.de/tnt/v2/shipments/search/${NUMBER}`,
      expect.objectContaining({ cache: 'no-store', redirect: 'error', headers: expect.objectContaining({ 'X-Language': 'de' }) }));
  });

  it('does not give an unknown historical update the delivered shipment stage', () => {
    const payload = fixture();
    payload[0].parcelProgress.push({ parcelStatus: 'FUTURE_STATUS', timestamp: '2026-09-02T09:00:00Z' });
    const result = parseHermesGermanyResponse(payload, NUMBER);
    expect(result.current_stage).toBe('delivered');
    expect(result.events?.find((event) => event.provider_code === 'FUTURE_STATUS')?.stage).toBe('in_transit');
  });

  it.each([403, 404, 429, 503])('classifies HTTP %i without hiding outages', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status }));
    await expect(new HermesGermanyTracker().fetch(NUMBER)).rejects.toMatchObject({
      status, name: status === 404 ? 'HermesGermanyTrackingError' : 'UpstreamHttpError',
    });
  });
});
