import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JsonObject } from '../../core/types';
import {
  GLSSwitzerlandTracker,
  GLSSwitzerlandTrackingError,
  glsSwitzerlandDetailApiUrl,
  glsSwitzerlandOverviewApiUrl,
  glsSwitzerlandTrackingUrl,
  normalizeGLSSwitzerlandPostcode,
  normalizeGLSSwitzerlandTrackingNumber,
  parseGLSSwitzerlandTrackingResponse,
} from './adapter';
import { glsSwitzerlandStatus } from './status';

// Intentional test identifiers from official documentation. Swiss Post's GLS
// guide publishes parcel 993990103198 alongside fictional “Test Entreprise”
// data, while GLS ShipIT publishes YZ8YO11K as a Track ID example:
// https://www.post.ch/-/media/post/gk/dokumente/anleitung-pakete-gls.pdf
// https://gls-shipit.gls-group.eu/webservices/5_0_15/doxygen/WS-REST-API/rest_tracking.html
// The delivered payload in fixtures/ is fully synthetic and exercises only the
// public provider shape; neither official example has retained live history.
const OFFICIAL_TEST_TRACK_ID = 'YZ8YO11K';
const OFFICIAL_TEST_PARCEL_NUMBER = '993990103198';
const WRONG_PARCEL_NUMBER = '88888888888';
const FIXED_MILLIS = 1_788_120_000_000;

const fixture = (name: string): JsonObject => JSON.parse(
  readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
) as JsonObject;
const deliveredOverviewFixture = () => fixture('overview-delivered');
const detailedFixture = (parcelNumber = OFFICIAL_TEST_PARCEL_NUMBER): JsonObject => ({
  ...fixture('detail-delivered'), tuNo: parcelNumber,
});
const parcelShopFixture = () => fixture('detail-parcelshop');
const capabilities = (JSON.parse(
  readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
) as { capabilities: string[] }).capabilities;

afterEach(() => vi.restoreAllMocks());

describe('GLS Switzerland tracking input', () => {
  it('accepts official parcel and Track ID forms and builds public URLs', () => {
    expect(normalizeGLSSwitzerlandTrackingNumber('yz8y-o1.1k')).toBe(OFFICIAL_TEST_TRACK_ID);
    expect(normalizeGLSSwitzerlandTrackingNumber('99 399 010 3198'))
      .toBe(OFFICIAL_TEST_PARCEL_NUMBER);
    expect(normalizeGLSSwitzerlandPostcode(' 8000 ')).toBe('8000');
    expect(normalizeGLSSwitzerlandPostcode(' 0800 ')).toBe('0800');
    expect(glsSwitzerlandTrackingUrl(OFFICIAL_TEST_TRACK_ID)).toBe(
      `https://gls-group.eu/EU/en/parcel-tracking?match=${OFFICIAL_TEST_TRACK_ID}`,
    );

    const overview = new URL(glsSwitzerlandOverviewApiUrl(
      OFFICIAL_TEST_PARCEL_NUMBER,
      FIXED_MILLIS,
    ));
    expect(overview.pathname).toBe('/app/service/open/rest/GROUP/en/rstt029');
    expect(Object.fromEntries(overview.searchParams)).toEqual({
      match: OFFICIAL_TEST_PARCEL_NUMBER,
      type: '',
      caller: 'witt002',
      millis: String(FIXED_MILLIS),
    });

    const detail = new URL(glsSwitzerlandDetailApiUrl(
      OFFICIAL_TEST_PARCEL_NUMBER,
      '8000',
      FIXED_MILLIS,
      'CH01',
    ));
    expect(detail.pathname).toBe(
      `/app/service/open/rest/GROUP/en/rstt028/${OFFICIAL_TEST_PARCEL_NUMBER}`,
    );
    expect(Object.fromEntries(detail.searchParams)).toEqual({
      caller: 'witt002',
      millis: String(FIXED_MILLIS),
      postalCode: '8000',
      tuOwnerCode: 'CH01',
    });
  });

  it('rejects unsafe identifiers and non-Swiss postcodes', () => {
    for (const value of [
      'ABC1234',
      'ABCDEFGH',
      '12345678',
      'ABC123456',
      '1234567890',
      'YZ8YO1/1K',
      'YZ8YO11K?x=1',
    ]) {
      expect(() => normalizeGLSSwitzerlandTrackingNumber(value)).toThrow(
        '8-character Track ID or an 11-to-14-digit parcel number',
      );
    }
    for (const value of ['800', '80000', '80A0', '8000?x=1']) {
      expect(() => normalizeGLSSwitzerlandPostcode(value)).toThrow('4-digit recipient postcode');
    }
  });
});

describe('GLS Switzerland response normalization', () => {
  it('parses a privacy-safe provider-shaped response for official test identifiers', () => {
    for (const identifier of [OFFICIAL_TEST_PARCEL_NUMBER, OFFICIAL_TEST_TRACK_ID]) {
      expect(parseGLSSwitzerlandTrackingResponse(deliveredOverviewFixture(), identifier)).toEqual({
        status: 'delivered',
        canonical_tracking_number: OFFICIAL_TEST_PARCEL_NUMBER,
        current_stage: 'delivered',
        last_status_text: 'The parcel has been delivered. For more information, please see the detailed shipment tracking below.',
        last_update: null,
        expected_delivery: null,
        timezone: 'Europe/Zurich',
        events: [],
      });
    }
  });

  it('normalizes detailed history and excludes recipient, address, and reference data', () => {
    const result = parseGLSSwitzerlandTrackingResponse(
      detailedFixture(),
      OFFICIAL_TEST_PARCEL_NUMBER,
    );
    expect(result).toMatchObject({
      status: 'delivered',
      last_status_text: 'The parcel has been delivered.',
      last_update: '2026-06-19T10:59:00+02:00',
      expected_delivery: null,
      timezone: 'Europe/Zurich',
    });
    expect(result.events).toEqual([{
      time: '2026-06-19T10:59:00+02:00',
      location: 'Switzerland Zurich',
      description: 'The parcel has been delivered.',
      stage: 'delivered',
      provider_code: '0.100',
    }, {
      time: '2026-06-18T08:14:00+02:00',
      location: 'Switzerland Zurich',
      description: 'The parcel has reached the final parcel center.',
      stage: 'in_transit',
      provider_code: '2.0',
    }]);
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      'Private Recipient',
      'Private Street',
      'private-order-reference',
      '+41000000000',
      '8000',
    ]) expect(serialized).not.toContain(privateValue);
  });

  it('covers every capability declared in carrier.json', () => {
    expect(capabilities).toEqual([
      'history', 'location', 'eta', 'pickup_point', 'weight', 'delivered_at', 'provider_code',
    ]);
    const delivered = parseGLSSwitzerlandTrackingResponse(detailedFixture(), OFFICIAL_TEST_PARCEL_NUMBER);
    expect(delivered.events?.length).toBeGreaterThan(0);
    expect(delivered.events?.some((event) => event.location)).toBe(true);
    expect(delivered.events?.some((event) => event.provider_code)).toBe(true);
    expect(delivered.delivered_at).toBe('2026-06-19T10:59:00+02:00');

    const waiting = parseGLSSwitzerlandTrackingResponse(parcelShopFixture(), OFFICIAL_TEST_PARCEL_NUMBER);
    expect(waiting).toMatchObject({
      status: 'out_for_delivery',
      current_stage: 'ready_for_pickup',
      pickup_point: 'GLS ParcelShop Zurich Altstetten Switzerland Zurich',
      weight_kg: 2.4,
      expected_delivery: '2026-06-20',
    });
    expect(JSON.stringify(waiting)).not.toContain('Private Street');
  });

  it('rejects malformed, empty, and mismatched responses', () => {
    expect(() => parseGLSSwitzerlandTrackingResponse({}, OFFICIAL_TEST_PARCEL_NUMBER))
      .toThrow('did not return tracking details');
    expect(() => parseGLSSwitzerlandTrackingResponse(
      { tuStatus: [] },
      OFFICIAL_TEST_PARCEL_NUMBER,
    ))
      .toThrow(GLSSwitzerlandTrackingError);
    expect(() => parseGLSSwitzerlandTrackingResponse(
      detailedFixture('993990103199'),
      OFFICIAL_TEST_PARCEL_NUMBER,
    )).toThrow('different shipment');
  });

  it('classifies each cross-border scan independently of the current shipment status', () => {
    const history = [
      ['The parcel has left the parcel center.', 'in_transit'],
      ['The parcel was released by customs.', 'in_transit'],
      ['Customs Consignment via Customs Portal', 'customs'],
      ['The parcel was handed over to GLS.', 'accepted'],
      ['The parcel data was entered into the GLS IT system; the parcel was not yet handed over to GLS.', 'registered'],
    ];
    const result = parseGLSSwitzerlandTrackingResponse({
      tuNo: OFFICIAL_TEST_PARCEL_NUMBER,
      progressBar: { statusInfo: 'INTRANSIT', statusText: 'In transit' },
      history: history.map(([evtDscr], index) => ({
        date: `2026-06-${19 - index}`, time: '05:47:36', evtDscr,
      })),
    }, OFFICIAL_TEST_PARCEL_NUMBER);
    expect(result.current_stage).toBe('in_transit');
    expect(result.events?.map((event) => event.stage)).toEqual(history.map(([, stage]) => stage));
  });

  it.each([
    ['The parcel has been released by customs.', 'in_transit'],
    ['The parcel has been handed over to GLS.', 'accepted'],
    ['The parcel has not been handed over to GLS.', 'in_transit'],
    ['The parcel has not been released by customs.', 'customs'],
    ['The parcel is in delivery.', 'out_for_delivery'],
    ['The parcel has reached the parcel center.', 'in_transit'],
  ])('maps the history scan %s to %s', (evtDscr, stage) => {
    const result = parseGLSSwitzerlandTrackingResponse({
      tuNo: OFFICIAL_TEST_PARCEL_NUMBER,
      progressBar: { statusInfo: 'INTRANSIT' },
      history: [{ date: '2026-06-19', time: '08:00', evtDscr }],
    }, OFFICIAL_TEST_PARCEL_NUMBER);
    expect(result.events?.[0].stage).toBe(stage);
  });

  it.each([
    ['PREADVICE', 'pending'],
    ['INTRANSIT', 'in_transit'],
    ['INDELIVERY', 'out_for_delivery'],
    ['DELIVERED', 'delivered'],
    ['NOTDELIVERED', 'exception'],
    ['NEW', 'unknown'],
  ] as const)('maps %s to %s', (providerStatus, expected) => {
    expect(glsSwitzerlandStatus(providerStatus)).toBe(expected);
  });
});

describe('GLS Switzerland tracker', () => {
  it('uses the anonymous overview and postcode-gated detail requests', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(deliveredOverviewFixture()), {
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(detailedFixture()), {
        headers: { 'Content-Type': 'application/json' },
      }));

    await expect(new GLSSwitzerlandTracker({ timeoutMs: 1_000, now: () => FIXED_MILLIS })
      .fetch(OFFICIAL_TEST_PARCEL_NUMBER, '8000')).resolves.toMatchObject({
      status: 'delivered',
      events: [{ stage: 'delivered' }, { stage: 'in_transit' }],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      glsSwitzerlandOverviewApiUrl(OFFICIAL_TEST_PARCEL_NUMBER, FIXED_MILLIS),
    );
    expect(String(fetcher.mock.calls[1]?.[0])).toBe(
      glsSwitzerlandDetailApiUrl(OFFICIAL_TEST_PARCEL_NUMBER, '8000', FIXED_MILLIS),
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      cache: 'no-store',
      redirect: 'error',
      headers: expect.objectContaining({ Accept: 'application/json' }),
    });
  });

  it('maps the provider wrong-number response to a clean not-found error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      lastError: 'E206',
      exceptionText: 'Unfortunately there are no results.<br>Please check your entry.',
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(new GLSSwitzerlandTracker({ timeoutMs: 1_000, now: () => FIXED_MILLIS })
      .fetch(WRONG_PARCEL_NUMBER)).rejects.toMatchObject({
      name: 'GLSSwitzerlandTrackingError',
      message: 'GLS Switzerland could not locate the shipment',
      status: 404,
    });
  });
});
