import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CanadaPostTracker,
  canadaPostTrackingUrl,
  parseCanadaPostTrackingResponse,
} from './adapter';
import { CANADA_POST_STATUS_STAGE, canadaPostStage, canadaPostStatus } from './status';

// 0073938000999999 and 0073938000888888 are made-up numbers in Canada Post's
// published format. No real shipment, recipient or signatory appears in this
// file.
const DELIVERED_NUMBER = '0073938000999999';
const IN_TRANSIT_NUMBER = '0073938000888888';
const DELIVERED = (JSON.parse(
  readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'),
) as { items: Record<string, unknown>[] }).items;
const IN_TRANSIT = (JSON.parse(
  readFileSync(new URL('./fixtures/in-transit.json', import.meta.url), 'utf8'),
) as { items: Record<string, unknown>[] }).items;
const CAPABILITIES = (JSON.parse(
  readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
) as { capabilities: string[] }).capabilities;

afterEach(() => vi.restoreAllMocks());

describe('Canada Post status vocabulary', () => {
  it('maps the package code, the wording, and nothing else', () => {
    expect(CANADA_POST_STATUS_STAGE['8']).toBe('delivered');
    expect(CANADA_POST_STATUS_STAGE['7']).toBe('ready_for_pickup');
    expect(CANADA_POST_STATUS_STAGE['2']).toBe('in_transit');
    expect(canadaPostStage('Notice left')).toBe('failed_attempt');
    expect(canadaPostStatus('8', 'Out for delivery')).toBe('delivered');
    expect(canadaPostStatus('5', 'Delivered')).toBe('in_transit');
    // Unrecognized wording only means "moving" once the shipment has scans.
    expect(canadaPostStatus('9', 'Wording Canada Post has not used before')).toBe('unknown');
    expect(canadaPostStatus('9', 'Wording Canada Post has not used before', true)).toBe('in_transit');
    expect(canadaPostStage('Wording Canada Post has not used before')).toBeNull();
  });
});

describe('Canada Post structured response', () => {
  it('projects the delivered history with per-scan codes', () => {
    const result = parseCanadaPostTrackingResponse(structuredClone(DELIVERED), DELIVERED_NUMBER);
    expect(result).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Delivered',
      last_update: '2026-03-14T08:00:00Z',
      delivered_at: '2026-03-14',
      expected_delivery: null,
    });
    expect(result.events).toEqual([
      { time: '2026-03-14T08:00:00Z', location: 'OTTAWA, ON', description: 'Delivered', stage: 'delivered', provider_code: 'D1' },
      { time: '2026-03-14T07:00:00Z', location: 'OTTAWA, ON', description: 'Out for delivery', stage: 'out_for_delivery', provider_code: 'O1' },
      { time: '2026-03-12T09:30:00Z', location: 'TORONTO, ON', description: 'Accepted at the post office', stage: 'accepted', provider_code: 'A1' },
    ]);
  });

  it('projects an in-transit parcel with its estimate', () => {
    const result = parseCanadaPostTrackingResponse(structuredClone(IN_TRANSIT), IN_TRANSIT_NUMBER);
    expect(result).toMatchObject({
      status: 'in_transit',
      current_stage: 'in_transit',
      last_status_text: 'In transit',
      last_update: '2026-03-15T22:41:00Z',
      expected_delivery: '2026-03-20',
    });
    expect(result.events).toHaveLength(2);
    expect(result).not.toHaveProperty('delivered_at');
  });

  it('keeps the signatory and service blocks out of the result', () => {
    const serialized = JSON.stringify(parseCanadaPostTrackingResponse(structuredClone(DELIVERED), DELIVERED_NUMBER));
    for (const value of ['PRIVATE RECIPIENT', 'PRIVATE SERVICE', 'PRIVATE OPTION', 'productNmEn', 'deliveryOptions']) {
      expect(serialized).not.toContain(value);
    }
  });

  it('produces every capability carrier.json declares', () => {
    expect(CAPABILITIES).toEqual(['history', 'location', 'eta', 'delivered_at']);
    const result = parseCanadaPostTrackingResponse(structuredClone(DELIVERED), DELIVERED_NUMBER);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some((event) => event.location)).toBe(true);
    expect(result.delivered_at).toBeTruthy();
    expect(parseCanadaPostTrackingResponse(structuredClone(IN_TRANSIT), IN_TRANSIT_NUMBER).expected_delivery).toBeTruthy();
  });

  it('fails closed on another parcel, duplicates and invalid envelopes', () => {
    const other = structuredClone(DELIVERED);
    other[0]!.pin = '0073938000000000';
    expect(() => parseCanadaPostTrackingResponse(other, DELIVERED_NUMBER))
      .toThrow('Canada Post did not return the requested parcel');
    const duplicated = [...structuredClone(DELIVERED), ...structuredClone(DELIVERED)];
    expect(() => parseCanadaPostTrackingResponse(duplicated, DELIVERED_NUMBER))
      .toThrow('several shipments');
    expect(() => parseCanadaPostTrackingResponse({ items: [] }, DELIVERED_NUMBER))
      .toThrow('invalid tracking response');
    expect(() => parseCanadaPostTrackingResponse('not an object', DELIVERED_NUMBER))
      .toThrow('invalid tracking response');
  });

  it('reports an error-only envelope as unlocated', () => {
    expect(parseCanadaPostTrackingResponse(
      [{ refNbr1: '0073938000000000', error: { cd: '004', descEn: 'No PIN History' } }],
      '0073938000000000',
    )).toMatchObject({ status: 'unknown', events: [], last_status_text: 'Canada Post could not locate the shipment' });
  });
});

describe('Canada Post lookup', () => {
  it('reads the JSON endpoint with the empty Basic credential', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(structuredClone(DELIVERED)));

    const result = await new CanadaPostTracker({ timeoutMs: 2_000, fetcher }).fetch(DELIVERED_NUMBER);

    expect(result).toMatchObject({
      status: 'delivered',
      tracking_source: 'structured-web-response',
      tracking_url: canadaPostTrackingUrl(DELIVERED_NUMBER),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://www.canadapost-postescanada.ca/track-reperage/rs/track/json/package?refNbrs=0073938000999999');
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Accept: 'application/json, text/plain, */*',
      Authorization: 'Basic Og==',
    });
  });

  it('rejects a number that is not a Canada Post number before any request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('must not fetch'));
    await expect(new CanadaPostTracker({ fetcher }).fetch('1Z999AA10123456784'))
      .rejects.toThrow('Canada Post tracking numbers must contain 13 to 24 digits');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('builds the canonical tracking URL', () => {
    expect(new URL(canadaPostTrackingUrl(DELIVERED_NUMBER)).hash).toContain(DELIVERED_NUMBER);
  });
});
