import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StepRecorder } from '../../core/telemetry';
import {
  parseRoyalMailTrackingHtml,
  parseRoyalMailTrackingResponse,
  RoyalMailTracker,
  royalMailSummaryApiUrl,
  royalMailTrackingUrl,
} from './adapter';
import { royalMailStage, royalMailStatus } from './status';

// SG999999999GB and SG999999998GB are made-up numbers in Royal Mail's
// published S10 format. No real shipment, recipient or signatory appears in
// this file.
const DELIVERED_NUMBER = 'SG999999999GB';
const IN_TRANSIT_NUMBER = 'SG999999998GB';
const TRAWL_URL = 'http://trawl.internal:8191';
const DELIVERED = JSON.parse(
  readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const IN_TRANSIT = JSON.parse(
  readFileSync(new URL('./fixtures/in-transit.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const CAPABILITIES = (JSON.parse(
  readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
) as { capabilities: string[] }).capabilities;

function stepRecorder(): { recorder: StepRecorder; records: string[] } {
  const records: string[] = [];
  return {
    records,
    recorder: {
      step: (record) => records.push(`${record.step}:${record.outcome}`),
      lookup: (record) => records.push(`lookup:${record.finalStep}:${record.outcome}`),
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('Royal Mail status vocabulary', () => {
  it('maps the wording, and nothing else', () => {
    expect(royalMailStage('Delivered')).toBe('delivered');
    expect(royalMailStage('Out for delivery')).toBe('out_for_delivery');
    expect(royalMailStage('Delivery attempted')).toBe('failed_attempt');
    expect(royalMailStage('Sender preparing item')).toBe('registered');
    expect(royalMailStage('Your item will be delivered tomorrow')).toBeNull();
    expect(royalMailStage('Arrived at delivery office')).toBe('in_transit');
    expect(royalMailStage('Redirected')).toBe('in_transit');
    expect(royalMailStage('Ready for collection')).toBe('ready_for_pickup');
    expect(royalMailStatus('Delivered')).toBe('delivered');
    // Unknown wording does not establish movement.
    expect(royalMailStatus('Wording Royal Mail has not used before')).toBe('unknown');
    expect(royalMailStage('Wording Royal Mail has not used before')).toBeNull();
  });
});

describe('Royal Mail structured response', () => {
  it.each([
    ["We're expecting it", 'New provider description', 'pending', 'registered'],
    ["We've got it", 'New provider description', 'in_transit', 'accepted'],
    ['Released from Customs', 'Released from Customs', 'in_transit', 'in_transit'],
    ['Ready for Delivery', '', 'in_transit', 'in_transit'],
    ['Duplicate Identified', 'New provider description', 'exception', 'exception'],
    ['No Status', 'New provider description', 'unknown', undefined],
  ])('uses summary category %s independently of scan wording', (category, description, status, stage) => {
    const result = parseRoyalMailTrackingResponse({mailPieces: {
      mailPieceId: DELIVERED_NUMBER,
      summary: {statusCategory: category, statusDescription: description},
    }}, DELIVERED_NUMBER);
    expect(result.status).toBe(status);
    expect(result.current_stage).toBe(stage);
  });

  it('distinguishes completed collection from an earlier carrier collection scan', () => {
    const result = parseRoyalMailTrackingResponse({mailPieces: {
      mailPieceId: DELIVERED_NUMBER,
      summary: {statusCategory: 'Collected', statusDescription: 'Collected by PRIVATE RECIPIENT'},
      estimatedDelivery: {date: '2026-03-20'},
      events: [{eventName: 'Collected', eventDateTime: '2026-03-12T09:30:00Z'}],
    }}, DELIVERED_NUMBER);
    expect(result).toMatchObject({status: 'delivered', current_stage: 'delivered', last_status_text: 'Delivered', expected_delivery: null});
    expect(result.events?.[0]?.stage).toBe('accepted');
    expect(JSON.stringify(result)).not.toContain('PRIVATE RECIPIENT');
  });

  it('projects the delivered summary with per-scan codes', () => {
    const result = parseRoyalMailTrackingResponse(structuredClone(DELIVERED), DELIVERED_NUMBER);
    expect(result).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Delivered',
      last_update: '2026-03-14T08:00:00Z',
      expected_delivery: null,
    });
    expect(result.events).toEqual([
      { time: '2026-03-14T08:00:00Z', location: 'LONDON', description: 'Delivered', stage: 'delivered', provider_code: 'DL' },
      { time: '2026-03-14T07:00:00Z', location: 'LONDON', description: 'Out for delivery', stage: 'out_for_delivery', provider_code: 'OD' },
      { time: '2026-03-13T18:15:00Z', location: 'LONDON', description: 'Arrived at delivery office', stage: 'in_transit', provider_code: 'AR' },
      { time: '2026-03-12T09:30:00Z', location: 'SWINDON', description: 'Item received', stage: 'accepted', provider_code: 'AC' },
    ]);
  });

  it('projects an in-transit mailpiece with its estimate', () => {
    const result = parseRoyalMailTrackingResponse(structuredClone(IN_TRANSIT), IN_TRANSIT_NUMBER);
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

  it('keeps the signatory out of the result', () => {
    const serialized = JSON.stringify(parseRoyalMailTrackingResponse(structuredClone(DELIVERED), DELIVERED_NUMBER));
    expect(serialized).not.toContain('PRIVATE RECIPIENT');
  });

  it('produces every capability carrier.json declares', () => {
    expect(CAPABILITIES).toEqual(['history', 'location', 'eta']);
    const result = parseRoyalMailTrackingResponse(structuredClone(DELIVERED), DELIVERED_NUMBER);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some((event) => event.location)).toBe(true);
    expect(parseRoyalMailTrackingResponse(structuredClone(IN_TRANSIT), IN_TRANSIT_NUMBER).expected_delivery).toBeTruthy();
  });

  it('rejects wrong identities, arrays, empty replies and gateway 404s', () => {
    const other = structuredClone(DELIVERED);
    (other.mailPieces as Record<string, unknown>).mailPieceId = 'SG999999997GB';
    expect(() => parseRoyalMailTrackingResponse(other, DELIVERED_NUMBER)).toThrow('requested parcel');
    for (const payload of [{}, { unexpected: true }, { mailPieces: [DELIVERED, DELIVERED] },
      { httpCode: '404', httpMessage: 'Not Found', moreInformation: 'No resources match requested URI' }, 'text']) {
      expect(() => parseRoyalMailTrackingResponse(payload, DELIVERED_NUMBER)).toThrow('invalid tracking response');
    }
  });

  it('keeps denials, throttles and inconclusive errors distinct', () => {
    expect(() => parseRoyalMailTrackingResponse({ errors: [{ code: 'E0015' }] }, DELIVERED_NUMBER))
      .toThrow('denied the tracking session');
    expect(() => parseRoyalMailTrackingResponse({ httpCode: '429' }, DELIVERED_NUMBER))
      .toThrow('rate limiting');
    expect(() => parseRoyalMailTrackingResponse({ errors: [{ errorCode: 'E1142' }] }, DELIVERED_NUMBER))
      .toThrow('could not confirm');
  });

  it('supports summaries without history, sorts scans and does not guess unknown status', () => {
    const payload = structuredClone(DELIVERED);
    const piece = payload.mailPieces as Record<string, unknown>;
    (piece.events as unknown[]).reverse();
    expect(parseRoyalMailTrackingResponse(payload, DELIVERED_NUMBER).events?.[0]?.stage).toBe('delivered');
    delete piece.events;
    expect(parseRoyalMailTrackingResponse(payload, DELIVERED_NUMBER)).toMatchObject({status: 'delivered', events: []});
    (piece.summary as Record<string, unknown>).statusDescription = 'New provider status';
    expect(parseRoyalMailTrackingResponse(payload, DELIVERED_NUMBER).status).toBe('unknown');
  });

});

describe('Royal Mail lookup steps', () => {
  it('reports the missing browser service without any request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('must not fetch'));
    await expect(new RoyalMailTracker({ trawlUrl: '' }).fetch(DELIVERED_NUMBER))
      .rejects.toMatchObject({
        name: 'ChallengeError',
        message: 'Royal Mail challenged direct tracking; configure FLARESOLVERR_URL for browser fallback',
      });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads only the summary reply for the exact requested number', async () => {
    const summaryUrl = royalMailSummaryApiUrl(DELIVERED_NUMBER);
    const other = structuredClone(DELIVERED);
    (other.mailPieces as Record<string, unknown>).mailPieceId = 'SG999999997GB';
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({
      tier: 3,
      statusCode: 200,
      url: royalMailTrackingUrl(DELIVERED_NUMBER),
      html: '<html><body>tracking app</body></html>',
      cookies: [],
      userAgent: 'Mozilla/5.0 (test browser)',
      capturedResponses: [
        { url: summaryUrl, status: 200, headers: {}, body: JSON.stringify(structuredClone(DELIVERED)), truncated: false, base64Encoded: false, error: null },
        { url: 'https://api-web.royalmail.com/mailpieces/microsummary/v1/summary/SG999999997GB', status: 200, headers: {}, body: JSON.stringify(other), truncated: false, base64Encoded: false, error: null },
      ],
    }));
    const { recorder, records } = stepRecorder();

    const result = await new RoyalMailTracker({ timeoutMs: 2_000, trawlUrl: TRAWL_URL, recorder }).fetch(DELIVERED_NUMBER);

    expect(result).toMatchObject({
      status: 'delivered',
      tracking_source: 'structured-web-response',
      tracking_url: royalMailTrackingUrl(DELIVERED_NUMBER),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      url: royalMailTrackingUrl(DELIVERED_NUMBER),
      skipHttp: true,
      maxTier: 3,
      captureResponses: [summaryUrl],
    });
    expect(records).toEqual(['trawl:ok', 'lookup:trawl:ok']);
  });

  it.each([200, 304])('accepts browser document HTTP %s only with a valid tracking capture', async (statusCode) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      tier: 3, statusCode, html: '<html>tracking app</html>',
      capturedResponses: [{url: royalMailSummaryApiUrl(DELIVERED_NUMBER), status: 200,
        body: JSON.stringify(DELIVERED), headers: {}}],
    }));
    await expect(new RoyalMailTracker({trawlUrl: TRAWL_URL, fetcher}).fetch(DELIVERED_NUMBER))
      .resolves.toMatchObject({status: 'delivered'});
  });

  it.each([[1, 200], [3, 302], [3, 0]])('rejects unsolved browser tier %s / document %s', async (tier, statusCode) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({tier, statusCode, html: '<html>app</html>'}));
    await expect(new RoyalMailTracker({trawlUrl: TRAWL_URL, fetcher}).fetch(DELIVERED_NUMBER))
      .rejects.toMatchObject({name: 'TransportError'});
  });

  it.each([
    [404, {errors: [{errorCode: 'E1142'}]}, 'IndeterminateError'],
    [403, {}, 'ChallengeError'],
    [429, {}, 'RateLimitedError'],
    [200, {errors: [{errorCode: 'E0015'}]}, 'ChallengeError'],
    [200, {mailPieces: {mailPieceId: 'SG999999997GB', summary: {statusDescription: 'Delivered'}}}, 'SchemaError'],
  ])('preserves failure classification for HTTP %s', async (status, payload, name) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      tier: 3, statusCode: 200, html: '<html>tracking app</html>',
      capturedResponses: [{url: royalMailSummaryApiUrl(DELIVERED_NUMBER), status,
        body: JSON.stringify(payload), headers: {'retry-after': '60'}}],
    }));
    await expect(new RoyalMailTracker({trawlUrl: TRAWL_URL, fetcher}).fetch(DELIVERED_NUMBER))
      .rejects.toMatchObject({name, ...(status === 429 ? {retryAfterMs: 60_000} : {})});
  });

  it('names a challenged browser page instead of reporting it as not-found', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tier: 3,
        statusCode: 200,
        url: royalMailTrackingUrl(DELIVERED_NUMBER),
        html: '<html><body><h1>Access Denied</h1></body></html>',
        cookies: [],
        userAgent: 'Mozilla/5.0 (test browser)',
        capturedResponses: [],
      }), { headers: { 'Content-Type': 'application/json' } }));

    await expect(new RoyalMailTracker({ timeoutMs: 2_000, trawlUrl: TRAWL_URL }).fetch(DELIVERED_NUMBER))
      .rejects.toMatchObject({ name: 'ChallengeError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects a number that is not a Royal Mail number before any request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('must not fetch'));
    await expect(new RoyalMailTracker({ trawlUrl: TRAWL_URL }).fetch('1Z999AA10123456784'))
      .rejects.toThrow('Royal Mail tracking numbers must match the UPU S10 format');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('builds the canonical tracking and summary URLs', () => {
    expect(royalMailTrackingUrl(DELIVERED_NUMBER)).toBe(
      `https://www.royalmail.com/track-your-item#/tracking-results/${DELIVERED_NUMBER}`);
    expect(royalMailSummaryApiUrl(DELIVERED_NUMBER)).toBe(
      `https://api-web.royalmail.com/mailpieces/microsummary/v1/summary/${DELIVERED_NUMBER}`);
  });
});

describe('Royal Mail rendered page', () => {
  it('tells a challenge from an inconclusive load', () => {
    expect(parseRoyalMailTrackingHtml('<html><body><h1>Access Denied</h1></body></html>')).toBe('challenged');
    expect(parseRoyalMailTrackingHtml('<html><body>Track your item</body></html>')).toBe('inconclusive');
  });
});
