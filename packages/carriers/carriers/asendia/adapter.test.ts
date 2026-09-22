import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { carrierErrorKind, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierResult } from '../../core/result';
import { REGISTRY } from '../../generated/registry';
import {
  adapter,
  AsendiaA1Tracker,
  asendiaA1TrackingUrl,
  normalizeAsendiaA1TrackingNumber,
  parseAsendiaA1PublicConfig,
  parseAsendiaA1TrackingResponse,
} from './adapter';
import { classifyAsendiaA1Event } from './status';

// Published on https://www.ship24.com/couriers/asendia-tracking as an Asendia
// example; each fixture's other references are synthetic.
const NUMBER = 'AS010501721US';
const CUSTOMER_REFERENCE = 'SYNTHETICORDER000001';
const VENDOR_REFERENCE = 'BAINT000000000000001';
const API_KEY = '00000000-0000-4000-8000-00000000000A';
const TRACKING_KEY = '00000000-0000-4000-8000-00000000000B';
const AUTHORIZATION = `Basic ${Buffer.from('synthetic@example.test:not-a-secret').toString('base64')}`;
// Shaped like the official page's js/main.js; every value is synthetic.
const PAGE_SCRIPT = `!function(){const b=JSON.parse('{\\n    "baseUrl": "https://a1reportapi.asendiaprod.com",\\n    `
  + `"authorizationHeaderValue": "${AUTHORIZATION}",\\n    "a1ApiKeyHeaderValue": "${API_KEY}"\\n}\\n'.toString()),`
  + 'h=`${b.baseUrl}/api/A1/TrackingBranded`;const v=(()=>{const e=window.location.href,'
  + `a="${TRACKING_KEY}";return{trackingKey:a}})()}();`;

function json(relativePath: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'));
}

const carrier = json('./carrier.json') as { capabilities: readonly string[] };

type A1Reply = Record<string, unknown> & {
  trackingBrandedSummary: Record<string, unknown>;
  trackingBrandedDetail: Array<Record<string, unknown>>;
};

function delivered(name = 'a1-delivered.json'): A1Reply {
  return json(`./fixtures/${name}`) as never;
}

const NOT_FOUND = { trackingBrandedSummary: {}, trackingBrandedDetail: [], responseStatus: { responseStatusCode: 204, responseStatusMessage: 'There were no package data found.' } };
const CUSTOMER = { trackingBrandedCustomer: { customerSettings: {} }, responseStatus: { responseStatusCode: 200, responseStatusMessage: '' } };
const NO_CUSTOMER = { trackingBrandedCustomer: null, responseStatus: { responseStatusCode: 204, responseStatusMessage: 'There were no customers configured for this tracking key.' } };

type Reply = Response | (() => Response);

/** A fetcher that answers by path and records every request. */
function upstream(routes: Record<string, Reply[]>) {
  const calls: Array<{ url: URL; headers: Headers }> = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    const key = url.pathname.split('/').pop()!;
    const reply = routes[key]?.shift();
    if (!reply) throw new Error(`unexpected request ${url.pathname}`);
    return typeof reply === 'function' ? reply() : reply;
  });
  return { fetcher, calls, paths: () => calls.map((call) => call.url.pathname.split('/').pop()) };
}

const jsonReply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const script = () => new Response(PAGE_SCRIPT);

describe('Asendia A1 public page configuration', () => {
  it('reads the page script values without pinning them', () => {
    expect(parseAsendiaA1PublicConfig(PAGE_SCRIPT)).toEqual({
      baseUrl: 'https://a1reportapi.asendiaprod.com',
      authorization: AUTHORIZATION,
      apiKey: API_KEY,
      trackingKey: TRACKING_KEY,
    });
  });

  it.each([
    ['a missing field', PAGE_SCRIPT.replace('a1ApiKeyHeaderValue', 'somethingElse'), 'no longer publishes'],
    ['a foreign API host', PAGE_SCRIPT.replace('a1reportapi.asendiaprod.com', 'a1reportapi.asendiaprod.com.evil.test'), 'unexpected tracking API address'],
    ['an API path', PAGE_SCRIPT.replace('asendiaprod.com"', 'asendiaprod.com/proxy"'), 'unexpected tracking API address'],
    ['plain HTTP', PAGE_SCRIPT.replace('https://a1report', 'http://a1report'), 'unexpected tracking API address'],
    ['a malformed credential', PAGE_SCRIPT.replace(AUTHORIZATION, 'Bearer abc'), 'invalid tracking API credentials'],
    ['two tracking keys', `${PAGE_SCRIPT}const c="00000000-0000-4000-8000-00000000000C";`, 'one tracking key'],
    ['no tracking key', PAGE_SCRIPT.replace(TRACKING_KEY, 'nothing'), 'one tracking key'],
  ])('fails as schema drift on %s', (_name, value, message) => {
    expect(() => parseAsendiaA1PublicConfig(value)).toThrow(SchemaError);
    expect(() => parseAsendiaA1PublicConfig(value)).toThrow(message);
  });
});

describe('Asendia A1 tracking numbers and links', () => {
  it('normalizes typed input and builds the official page link', () => {
    expect(normalizeAsendiaA1TrackingNumber(' as 010-501 721us ')).toBe(NUMBER);
    expect(asendiaA1TrackingUrl(NUMBER)).toBe(`https://a1.asendiausa.com/tracking/?trackingnumber=${NUMBER}`);
    for (const invalid of ['AB12', '', 'x'.repeat(41)]) {
      expect(() => normalizeAsendiaA1TrackingNumber(invalid)).toThrow(TypeError);
    }
  });
});

describe('Asendia A1 reply projection', () => {
  it('projects the history newest first with explicit offsets and coarse locations', () => {
    const result = parseAsendiaA1TrackingResponse(delivered(), NUMBER);
    expect(result).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Delivered',
      last_update: '2026-04-05T00:11:21Z',
      expected_delivery: null,
      weight_kg: 7.67,
      destination_country: 'CA',
      delivery_tracking_number: VENDOR_REFERENCE,
    });
    // Intelcom is not in the catalog, so no partner is named.
    expect(result.delivery_carrier).toBeUndefined();
    expect(result.events).toHaveLength(13);
    expect(result.events?.slice(0, 2)).toEqual([
      { time: '2026-04-05T00:11:21Z', location: 'Calgary, AB, CA', description: 'Delivered', stage: 'delivered', provider_code: 'B13' },
      { time: '2026-04-04T18:54:18Z', location: 'Calgary, AB, CA', description: 'Out for delivery', stage: 'out_for_delivery', provider_code: 'B12' },
    ]);
    expect(result.events?.slice(-4).map((event) => [event.time, event.provider_code, event.stage, event.location])).toEqual([
      ['2026-04-01T18:23:26Z', 'B40', undefined, ''],
      ['2026-03-31T19:36:02.723Z', '2.1', 'in_transit', 'Salt Lake City, UT, US'],
      ['2026-03-31T19:30:43.147Z', '2', 'accepted', 'Salt Lake City, UT, US'],
      ['2026-03-30T14:37:49.383Z', '1', 'registered', ''],
    ]);
    // Partner scans without an exact mapping keep no stage for the shared rules.
    expect(result.events?.find((event) => event.provider_code === 'B9')?.stage).toBeUndefined();
  });

  it('keeps address lines, postal codes and the order reference out of the result', () => {
    const serialized = JSON.stringify(parseAsendiaA1TrackingResponse(delivered(), NUMBER));
    for (const privateValue of ['Private Street', 'T0T 0T0', CUSTOMER_REFERENCE, 'e-PAQ']) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('binds the reply through any reference A1 reports for the shipment', () => {
    expect(parseAsendiaA1TrackingResponse(delivered(), CUSTOMER_REFERENCE).status).toBe('delivered');
    const byVendor = parseAsendiaA1TrackingResponse(delivered(), VENDOR_REFERENCE);
    expect(byVendor.status).toBe('delivered');
    // The queried number is the last-mile reference itself: nothing to hand off.
    expect(byVendor.delivery_tracking_number).toBeUndefined();
    expect(() => parseAsendiaA1TrackingResponse(delivered(), 'AS000000019US')).toThrow('different shipment');
    const anonymous = delivered();
    anonymous.trackingBrandedSummary = {};
    expect(() => parseAsendiaA1TrackingResponse(anonymous, NUMBER)).toThrow('did not identify the shipment');
  });

  it('names a catalog partner only from its official tracking link', () => {
    const payload = delivered();
    payload.trackingBrandedSummary.finalMileTrackingLink = 'https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=1234567890123456';
    expect(parseAsendiaA1TrackingResponse(payload, NUMBER).delivery_carrier).toBe('canada-post');
    payload.trackingBrandedSummary.finalMileTrackingLink = 'https://www.canadapost-postescanada.ca.evil.test/';
    expect(parseAsendiaA1TrackingResponse(payload, NUMBER).delivery_carrier).toBeUndefined();
  });

  it('separates not-found, other statuses and malformed replies', () => {
    expect(() => parseAsendiaA1TrackingResponse(NOT_FOUND, NUMBER)).toThrow(NotFoundError);
    const odd = { ...delivered(), responseStatus: { responseStatusCode: 500 } };
    expect(carrierErrorKind(catchError(() => parseAsendiaA1TrackingResponse(odd, NUMBER)))).toBe('indeterminate');
    expect(() => parseAsendiaA1TrackingResponse('<html>', NUMBER)).toThrow(SchemaError);
    const noHistory = delivered();
    delete (noHistory as Record<string, unknown>).trackingBrandedDetail;
    expect(() => parseAsendiaA1TrackingResponse(noHistory, NUMBER)).toThrow('invalid tracking history');
  });

  it('drops a scan without an explicit offset instead of guessing its zone', () => {
    const payload = delivered();
    payload.trackingBrandedDetail[0]!.eventOn = '2026-04-05T00:11:21';
    const result = parseAsendiaA1TrackingResponse(payload, NUMBER);
    expect(result.events).toHaveLength(12);
    expect(result).toMatchObject({ status: 'out_for_delivery', current_stage: 'out_for_delivery' });
  });

  it('falls back to the shared wording rules for an unmapped newest scan', () => {
    const payload = delivered();
    payload.trackingBrandedDetail = [{ eventCode: 'X1', eventDescription: 'Arrived at sort facility', eventOn: '2026-04-05T00:00:00+00:00' }];
    const result = parseAsendiaA1TrackingResponse(payload, NUMBER);
    expect(result.status).toBe('in_transit');
    expect(result.current_stage).toBeUndefined();
    expect(result.events?.[0]?.stage).toBeUndefined();
  });

  it('maps Asendia harmonized codes and keeps each duplicate scan once', () => {
    const result = parseAsendiaA1TrackingResponse(delivered('a1-harmonized.json'), 'EEUS027988469JP0');
    expect(result).toMatchObject({
      status: 'delivered', current_stage: 'delivered', weight_kg: 0.227, destination_country: 'JP',
      delivery_tracking_number: 'LS000000014CH',
    });
    expect(result.events?.map((event) => [event.provider_code, event.stage])).toEqual([
      ['DELIVERY', 'delivered'],
      ['OUTDELIVCENTER', 'out_for_delivery'],
      ['DELFAILUNKN', 'failed_attempt'],
      ['INDELIVCENTER', 'in_transit'],
      ['LEAVHUB', 'in_transit'],
      ['IMPCUSTOUT', 'in_transit'],
      ['IMPCUSTIN', 'customs'],
      ['ARRDEST', 'in_transit'],
      ['DEPHUB', 'in_transit'],
      ['ARRHUB', 'in_transit'],
      ['2.2', 'in_transit'],
      ['2.1', 'in_transit'],
      ['2', 'accepted'],
      ['CHECKIN', 'accepted'],
      ['1', 'registered'],
    ]);
    // Trailing spaces in provider locations are trimmed.
    expect(result.events?.find((event) => event.provider_code === 'IMPCUSTIN')?.location).toBe('KAWASAKI, KANAGAWA, JP');
    const serialized = JSON.stringify(result);
    for (const privateValue of ['Private Facility Road', '000-0000']) expect(serialized).not.toContain(privateValue);
  });

  it('reads partner codes only through wording and names the declared last-mile post', () => {
    const result = parseAsendiaA1TrackingResponse(delivered('a1-usps-leg.json'), 'AHOY1X39DP45');
    expect(result).toMatchObject({
      status: 'delivered', current_stage: 'delivered', weight_kg: 0.454, destination_country: 'CA',
      delivery_carrier: 'canada-post', delivery_tracking_number: 'LV000000014US',
    });
    const stageOf = (code: string) => result.events?.find((event) => event.provider_code === code)?.stage;
    expect(stageOf('I0')).toBe('delivered');
    expect(stageOf('DG')).toBe('out_for_delivery');
    // USPS "10" and "B1" are not Asendia's codes 1 or Broadreach's B-series.
    expect(stageOf('10')).toBeUndefined();
    expect(stageOf('B1')).toBeUndefined();
    expect(stageOf('2')).toBe('accepted');
    expect(result.events?.at(-1)).toMatchObject({ provider_code: 'MA', time: '2026-03-27T00:00:00Z' });
  });

  it.each(carrier.capabilities)('declares %s and the fixture proves it', (capability) => {
    const result = parseAsendiaA1TrackingResponse(delivered(), NUMBER);
    const checks: Record<string, (value: CarrierResult) => boolean> = {
      history: (value) => (value.events?.length ?? 0) > 0,
      location: (value) => (value.events ?? []).some((event) => Boolean(event.location)),
      provider_code: (value) => (value.events ?? []).some((event) => Boolean(event.provider_code)),
      weight: (value) => value.weight_kg != null,
    };
    expect(checks[capability], `unknown capability ${capability}`).toBeTypeOf('function');
    expect(checks[capability]!(result)).toBe(true);
  });
});

describe('Asendia A1 status vocabulary', () => {
  it.each([
    ['A1 Imported Data', '1', 'Shipment Information Received', 'pending', 'registered'],
    ['A1 Labelled Data', '1.1', 'Label created', 'pending', 'registered'],
    ['A1 Processed Data', '2', 'Processed by Asendia', 'in_transit', 'accepted'],
    ['A1 Sorted Data', '2.1', 'Sorted by Asendia', 'in_transit', 'in_transit'],
    ['A1 Manifested Data', '2.2', 'Dispatched by Asendia', 'in_transit', 'in_transit'],
    ['FullTrack API', 'PICKUPREAD', 'Available at pick-up point', 'out_for_delivery', 'ready_for_pickup'],
    ['FullTrack API', 'RETURNREFU', 'Returned (Refused item)', 'exception', 'returned'],
    ['FullTrack API', 'IMPCUSTRET', 'Customs retention', 'exception', 'exception'],
    ['BROADREACH API', 'B13', 'Delivered', 'delivered', 'delivered'],
    ['BROADREACH API', 'B12', 'Out for delivery', 'out_for_delivery', 'out_for_delivery'],
    ['BROADREACH API', 'B8', 'Customs released', 'in_transit', 'in_transit'],
  ] as const)('maps %s %s %s', (source, code, description, status, stage) => {
    expect(classifyAsendiaA1Event(source, code, description)).toEqual({ status, stage });
  });

  it('reads codes only for their own source and leaves the rest unmapped', () => {
    expect(classifyAsendiaA1Event('USPS TrackV2 API', '1', 'Arrived at USPS Regional Facility')).toBeNull();
    expect(classifyAsendiaA1Event('A1 Imported Data', 'DELIVERY', 'Delivered')).toBeNull();
    expect(classifyAsendiaA1Event('FullTrack API', 'RETCENTERIN', 'Checked in return centre')).toBeNull();
    expect(classifyAsendiaA1Event('A1 Imported Data', '9', 'Something new')).toBeNull();
    expect(classifyAsendiaA1Event('BROADREACH API', 'B99', 'Not delivered')).toBeNull();
    expect(classifyAsendiaA1Event('', '', 'Delivered')).toEqual({ status: 'delivered', stage: 'delivered' });
  });
});

function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected an error');
}

describe('Asendia A1 lookup flow', () => {
  it('reads the page once, validates its key, then reuses the configuration', async () => {
    const { fetcher, calls, paths } = upstream({
      'main.js': [script()],
      Customer: [jsonReply(CUSTOMER)],
      Tracking: [jsonReply(delivered()), jsonReply(delivered())],
    });
    const tracker = new AsendiaA1Tracker({ fetcher });
    const result = await tracker.fetch(NUMBER);
    expect(result).toMatchObject({
      status: 'delivered',
      tracking_url: `https://a1.asendiausa.com/tracking/?trackingnumber=${NUMBER}`,
      tracking_source: 'structured-web-response',
    });
    await tracker.fetch(NUMBER);
    expect(paths()).toEqual(['main.js', 'Customer', 'Tracking', 'Tracking']);
    const tracking = calls[2]!;
    expect(tracking.url.origin).toBe('https://a1reportapi.asendiaprod.com');
    expect(Object.fromEntries(tracking.url.searchParams)).toEqual({ trackingKey: TRACKING_KEY, trackingNumber: NUMBER });
    expect(tracking.headers.get('authorization')).toBe(AUTHORIZATION);
    expect(tracking.headers.get('x-asendiaone-apikey')).toBe(API_KEY);
    // Cloudflare refuses library User-Agents with error 1010.
    expect(tracking.headers.get('user-agent')).toMatch(/^Mozilla\/5\.0/);
    expect(calls[1]!.url.searchParams.get('trackingKey')).toBe(TRACKING_KEY);
  });

  it('trusts a not-found right after the key was accepted', async () => {
    const { fetcher, paths } = upstream({
      'main.js': [script()], Customer: [jsonReply(CUSTOMER)], Tracking: [jsonReply(NOT_FOUND)],
    });
    await expect(new AsendiaA1Tracker({ fetcher }).fetch(NUMBER)).rejects.toBeInstanceOf(NotFoundError);
    expect(paths()).toEqual(['main.js', 'Customer', 'Tracking']);
  });

  it('rechecks an older key before reporting not-found', async () => {
    let now = 1_000_000;
    const { fetcher, paths } = upstream({
      'main.js': [script()],
      Customer: [jsonReply(CUSTOMER), jsonReply(CUSTOMER)],
      Tracking: [jsonReply(delivered()), jsonReply(NOT_FOUND)],
    });
    const tracker = new AsendiaA1Tracker({ fetcher, now: () => now });
    await tracker.fetch(NUMBER);
    now += 20 * 60_000;
    await expect(tracker.fetch('AS000000019US')).rejects.toBeInstanceOf(NotFoundError);
    expect(paths()).toEqual(['main.js', 'Customer', 'Tracking', 'Tracking', 'Customer']);
  });

  it('re-reads the page when a not-found came from a key that no longer works', async () => {
    let now = 1_000_000;
    const { fetcher, paths } = upstream({
      'main.js': [script(), script()],
      Customer: [jsonReply(CUSTOMER), jsonReply(NO_CUSTOMER), jsonReply(CUSTOMER)],
      Tracking: [jsonReply(delivered()), jsonReply(NOT_FOUND), jsonReply(delivered())],
    });
    const tracker = new AsendiaA1Tracker({ fetcher, now: () => now });
    await tracker.fetch(NUMBER);
    now += 20 * 60_000;
    await expect(tracker.fetch(NUMBER)).resolves.toMatchObject({ status: 'delivered' });
    expect(paths()).toEqual(['main.js', 'Customer', 'Tracking', 'Tracking', 'Customer', 'main.js', 'Customer', 'Tracking']);
  });

  it('re-reads the page once when cached credentials are rejected', async () => {
    const rejected = { responseStatusCode: 401, responseStatusMessage: 'Authentication to the resource has been denied.' };
    const { fetcher, paths } = upstream({
      'main.js': [script(), script()],
      Customer: [jsonReply(CUSTOMER), jsonReply(CUSTOMER)],
      Tracking: [jsonReply(delivered()), jsonReply(rejected, 401), jsonReply(delivered())],
    });
    const tracker = new AsendiaA1Tracker({ fetcher });
    await tracker.fetch(NUMBER);
    await expect(tracker.fetch(NUMBER)).resolves.toMatchObject({ status: 'delivered' });
    expect(paths()).toEqual(['main.js', 'Customer', 'Tracking', 'Tracking', 'main.js', 'Customer', 'Tracking']);
  });

  it('reports freshly read credentials that are rejected as schema drift', async () => {
    const { fetcher } = upstream({
      'main.js': [script()],
      Customer: [jsonReply({ responseStatusCode: 403, responseStatusMessage: 'Authorization to the resource has been denied.' }, 403)],
    });
    const error = await new AsendiaA1Tracker({ fetcher }).fetch(NUMBER).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: 'AsendiaCredentialsError', kind: 'schema' });
  });

  it('fails as schema drift when the page key is refused', async () => {
    const { fetcher } = upstream({ 'main.js': [script()], Customer: [jsonReply(NO_CUSTOMER)] });
    await expect(new AsendiaA1Tracker({ fetcher }).fetch(NUMBER)).rejects.toThrow("no longer accepts its tracking page's public key");
  });

  it('classifies an edge refusal and a rate limit', async () => {
    const edge = upstream({ 'main.js': [script()], Customer: [new Response('error code: 1010', { status: 403 })] });
    await expect(new AsendiaA1Tracker({ fetcher: edge.fetcher }).fetch(NUMBER))
      .rejects.toMatchObject({ name: 'ChallengeError', kind: 'challenge' });

    const limited = upstream({
      'main.js': [script()], Customer: [jsonReply(CUSTOMER)],
      Tracking: [new Response('', { status: 429, headers: { 'retry-after': '120' } })],
    });
    await expect(new AsendiaA1Tracker({ fetcher: limited.fetcher }).fetch(NUMBER))
      .rejects.toMatchObject({ kind: 'rate_limited', retryAfterMs: 120_000 });
  });

  it('stops when the lookup budget is spent', async () => {
    let now = 0;
    const { fetcher } = upstream({
      'main.js': [() => { now += 30_000; return script(); }],
      Customer: [jsonReply(CUSTOMER)],
    });
    await expect(new AsendiaA1Tracker({ fetcher, now: () => now }).fetch(NUMBER))
      .rejects.toMatchObject({ name: 'BudgetExceededError', kind: 'budget' });
  });

  it('is the registered adapter and uses the environment fetcher', async () => {
    expect(REGISTRY.carriers.asendia).toBe('asendia');
    const { fetcher } = upstream({
      'main.js': [script()], Customer: [jsonReply(CUSTOMER)], Tracking: [jsonReply(delivered())],
    });
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, recorder: { step() {}, lookup() {} }, env: {} });
    expect(instance.steps).toEqual(['direct']);
    await expect(instance.track({ number: NUMBER })).resolves.toMatchObject({ status: 'delivered' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
