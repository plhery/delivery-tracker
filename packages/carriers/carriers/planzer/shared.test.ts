import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parsePlanzerTrackingHtml,
  PlanzerSharedTracker,
  validatePlanzerSharedUrl,
} from './shared';

const WRONG_SHARED_NUMBER = '9999000000000';
// A made-up access key of the right shape; a real one is a tracking credential
// and is never committed (PRIVACY.md).
const WRONG_SHARED_URL = 'https://trackandtrace.planzergroup.com/shared/sendungen/'
  + `${WRONG_SHARED_NUMBER}?accessKey=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
const SHARED_NUMBER = '999.90.00000001';
const ROUTE_STEPS: ReadonlyArray<readonly [string, string]> = [
  ['Erfasst', '2026-03-01T08:00:00+01:00'],
  ['Abholung', '2026-03-01T12:00:00+01:00'],
  ['Umschlaglager', '2026-03-02T06:00:00+01:00'],
  ['In Auslieferung', '2026-03-03T07:00:00+01:00'],
  ['Ausgeliefert', '2026-03-03T11:30:00+01:00'],
];

/** The shared route page, with `reached` steps drawn in the primary color. */
function routePage(reached: number): string {
  const steps = ROUTE_STEPS.map(([label, timestamp], index) => `
    <div class="text-center">
      <span class="tooltip-target${index < reached ? ' text-primary' : ''}" data-original-title="${label}"></span>
      <time datetime="${timestamp}">${timestamp.slice(0, 10)}</time>
    </div>`).join('');
  return `<html><body><main>${steps}</main></body></html>`;
}

afterEach(() => vi.restoreAllMocks());

describe('Planzer shared route page', () => {
  it('keeps only the steps the page marks as reached, newest first', () => {
    expect(parsePlanzerTrackingHtml(routePage(5), SHARED_NUMBER)).toEqual({
      status: 'delivered',
      last_status_text: 'Ausgeliefert',
      last_update: '2026-03-03T11:30:00+01:00',
      expected_delivery: '2026-03-03',
      tracking_number: '9999000000001',
      events: [
        { time: '2026-03-03T11:30:00+01:00', location: '', description: 'Delivered' },
        { time: '2026-03-03T07:00:00+01:00', location: '', description: 'Out for delivery' },
        { time: '2026-03-02T06:00:00+01:00', location: '', description: 'Shipment at the transfer depot' },
        { time: '2026-03-01T12:00:00+01:00', location: '', description: 'Shipment accepted from the sender' },
        { time: '2026-03-01T08:00:00+01:00', location: '', description: 'Shipment registered by Planzer' },
      ],
    });
  });

  it('stops at the last reached step while the parcel is still moving', () => {
    const result = parsePlanzerTrackingHtml(routePage(3), SHARED_NUMBER);
    expect(result).toMatchObject({ status: 'in_transit', last_status_text: 'Umschlaglager' });
    expect(result.events?.map((event) => event.description)).toEqual([
      'Shipment at the transfer depot',
      'Shipment accepted from the sender',
      'Shipment registered by Planzer',
    ]);
  });

  it('refuses a page whose route has not started', () => {
    expect(() => parsePlanzerTrackingHtml(routePage(0), SHARED_NUMBER))
      .toThrow('Planzer returned a shipment without a current stage');
  });
});

describe('Planzer shared no-data response', () => {
  it('maps the explicit no-shipments page to a clean 404', () => {
    expect(() => parsePlanzerTrackingHtml(
      '<html><body><main><p class="lead row-offset-md">Keine Sendungen gefunden.</p></main></body></html>',
      WRONG_SHARED_NUMBER,
    )).toThrow('Planzer could not locate the shipment');
  });

  it.each([
    '',
    '<html><body><main>T&amp;T Sendungsverfolgung</main></body></html>',
    '<html><body><main>Maintenance</main></body></html>',
  ])('does not misclassify an incomplete provider page as no data', (html) => {
    expect(() => parsePlanzerTrackingHtml(html, WRONG_SHARED_NUMBER))
      .toThrow('Planzer returned an invalid tracking page');
  });

  it('exercises the capability URL path without exposing the access key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      '<html><body><main><p class="lead row-offset-md">Keine Sendungen gefunden.</p></main></body></html>',
      { headers: { 'Content-Type': 'text/html' } },
    ));

    await expect(new PlanzerSharedTracker({ fetcher, timeoutMs: 1_000 })
      .fetch(WRONG_SHARED_NUMBER, WRONG_SHARED_URL))
      .rejects.toMatchObject({
        name: 'NotFoundError',
        status: 404,
        message: 'Planzer could not locate the shipment',
      });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('Planzer shared link validation', () => {
  it.each([
    ['http://trackandtrace.planzergroup.com/shared/sendungen/9999000000000?accessKey=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'must use https'],
    ['https://trackandtrace.planzergroup.example/shared/sendungen/9999000000000?accessKey=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'must use https'],
    ['https://trackandtrace.planzergroup.com/shared/sendungen/9999000000000', 'must include its accessKey'],
    ['https://trackandtrace.planzergroup.com/shared/sendungen/9999000000000?accessKey=short', 'must include its accessKey'],
    ['https://trackandtrace.planzergroup.com/shared/sendungen/9999000000001?accessKey=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'different tracking number'],
    ['https://trackandtrace.planzergroup.com/', 'shared shipment URL'],
    ['not a url', 'valid Planzer tracking URL'],
  ])('rejects %s', (url, message) => {
    expect(() => validatePlanzerSharedUrl(url, WRONG_SHARED_NUMBER)).toThrow(message);
  });

  it('returns the canonical URL for a complete shared link', () => {
    expect(validatePlanzerSharedUrl(` ${WRONG_SHARED_URL} `, WRONG_SHARED_NUMBER)).toBe(WRONG_SHARED_URL);
  });
});
