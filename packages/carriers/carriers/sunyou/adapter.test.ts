import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CarrierResult } from '../../core/result';
import { fetchSunYou, parseSunYouTrackingResponse, SunYouTracker } from './adapter';

const folder = path.dirname(fileURLToPath(import.meta.url));
const carrier = JSON.parse(
  readFileSync(path.join(folder, 'carrier.json'), 'utf8'),
) as { capabilities: string[] };

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(folder, 'fixtures', name), 'utf8'));
}

const SUNYOU_WRONG_NUMBER = 'SY00000000000';

/** The endpoint answers JSONP, not JSON. */
function jsonpResponse(payload: unknown): Response {
  return new Response(`searchCallback(${JSON.stringify(payload)})`);
}

afterEach(() => vi.restoreAllMocks());

describe('SunYou wrong-number handling', () => {
  it('maps the official not-found status to a privacy-safe 404', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonpResponse({
      data: [{
        displayStatus: '0',
        has: true,
        orderNo: SUNYOU_WRONG_NUMBER,
        privateMessage: 'Private upstream details',
      }],
      message: 'success',
      status: 1,
    }));

    try {
      await fetchSunYou(SUNYOU_WRONG_NUMBER);
      throw new Error('Expected the lookup to fail');
    } catch (error) {
      expect(error).toMatchObject({ name: 'NotFoundError', status: 404, kind: 'not_found' });
      expect(String(error)).toContain('SunYou could not locate the shipment');
      expect(String(error)).not.toContain('Private upstream details');
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    const requested = new URL(String(fetcher.mock.calls[0]![0]));
    expect(requested.searchParams.get('trackNumber')).toBe(SUNYOU_WRONG_NUMBER);
  });

  it('keeps an outage or challenge page retryable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      '<html><title>Service unavailable</title></html>',
    ));

    await expect(fetchSunYou(SUNYOU_WRONG_NUMBER))
      .rejects.toThrow('SunYou returned an invalid tracking response');
  });

  it('rejects an answer describing a different shipment', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      'searchCallback({"data":[{"orderNo":"SY11111111111","has":false}]})',
    ));

    await expect(fetchSunYou(SUNYOU_WRONG_NUMBER)).rejects.toThrow('different shipment');
  });

  it('uses the environment fetcher the factory hands the tracker', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonpResponse({
      data: [{ orderNo: SUNYOU_WRONG_NUMBER, displayStatus: '1', has: true }],
    }));
    const global = vi.spyOn(globalThis, 'fetch');

    await expect(new SunYouTracker({ fetcher }).fetch(SUNYOU_WRONG_NUMBER))
      .resolves.toMatchObject({ status: 'in_transit' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(global).not.toHaveBeenCalled();
  });
});

describe('official SunYou display statuses', () => {
  it.each([
    ['1', 'in_transit', 'in_transit'],
    ['2', 'out_for_delivery', 'ready_for_pickup'],
    ['3', 'exception', 'failed_attempt'],
    ['4', 'delivered', 'delivered'],
    ['5', 'exception', 'failed_attempt'],
    ['6', 'exception', 'failed_attempt'],
  ] as const)('maps displayStatus %s to %s / %s', async (displayStatus, status, stage) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonpResponse({
      data: [{
        displayStatus,
        has: true,
        orderNo: SUNYOU_WRONG_NUMBER,
        result: {
          origin: {
            items: [{ createTime: '2026-08-30T12:00:00Z', content: 'Latest event' }],
          },
        },
      }],
    }));

    await expect(fetchSunYou(SUNYOU_WRONG_NUMBER)).resolves.toMatchObject({
      status,
      current_stage: stage,
      events: [{ stage }],
    });
  });
});

describe('SunYou event timezones', () => {
  function sunYouResponse(origin: unknown[], destination: unknown[]) {
    return jsonpResponse({
      data: [{
        displayStatus: '4',
        has: true,
        orderNo: SUNYOU_WRONG_NUMBER,
        result: { origin: { items: origin }, destination: { items: destination } },
      }],
    });
  }

  it('honors per-leg offsets and orders by instant rather than wall-clock string', async () => {
    // Observed on a captured SYAE shipment: origin scans carry "+08:00" while
    // the wall-clock strings would sort the other way round.
    // Source: https://github.com/ha-parcel-integrations/ha-sunyou/blob/main/tests/payloads.py
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sunYouResponse(
      [{ createTime: '2021-07-06 01:43:13', timeZone: '+08:00', content: 'Origin scan' }],
      [{ createTime: '2021-07-05 20:00:00', timeZone: '+02:00', content: 'Destination scan' }],
    ));

    const result = await fetchSunYou(SUNYOU_WRONG_NUMBER);
    expect(result.events?.map((event) => [event.description, event.time])).toEqual([
      ['Destination scan', '2021-07-05T20:00:00+02:00'],
      ['Origin scan', '2021-07-06T01:43:13+08:00'],
    ]);
  });

  it('keeps provider text when no usable offset exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sunYouResponse(
      [
        { createTime: '2021-07-06 01:43:13', content: 'No zone' },
        { createTime: '2021-07-06 01:44:13', timeZone: 'Mars', content: 'Bad zone' },
        { createTime: '2021-07-07T01:45:13+08:00', timeZone: '+02:00', content: 'Already offset' },
      ],
      [],
    ));

    const result = await fetchSunYou(SUNYOU_WRONG_NUMBER);
    expect(result.events?.map((event) => event.time)).toEqual([
      '2021-07-07T01:45:13+08:00',
      '2021-07-06 01:44:13',
      '2021-07-06 01:43:13',
    ]);
  });
});

describe('SunYou declared capabilities and privacy', () => {
  const delivered = parseSunYouTrackingResponse(fixture('delivered.json'), 'SYAE100000001');
  const checks: Record<string, (result: CarrierResult) => boolean> = {
    history: (result) => (result.events?.length ?? 0) > 0,
    location: (result) => (result.events ?? []).some((event) => Boolean(event.location)),
    eta: (result) => Boolean(result.expected_delivery),
    eta_window: (result) => Boolean(result.expected_delivery_from),
    sender_name: (result) => Boolean(result.sender_name),
    pickup_point: (result) => Boolean(result.pickup_point),
    weight: (result) => result.weight_kg != null,
    dimensions: (result) => Boolean(result.dimensions_text),
    delivered_at: (result) => Boolean(result.delivered_at),
    provider_code: (result) => (result.events ?? []).some((event) => Boolean(event.provider_code)),
  };

  it('merges both legs into one journey ordered by absolute instant', () => {
    expect(delivered).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Delivered',
      last_update: '2026-09-03 11:20:00',
      expected_delivery: null,
    });
    expect(delivered.events?.map((event) => [event.description, event.time])).toEqual([
      ['Delivered', '2026-09-03T11:20:00+02:00'],
      ['Arrived at the destination facility', '2026-09-02T07:15:00+02:00'],
      ['Departed from the origin facility', '2026-08-29T21:40:00+08:00'],
      ['Shipment picked up', '2026-08-28T09:10:00+08:00'],
    ]);
    // Only the newest scan inherits the shipment-level stage.
    expect(delivered.events?.map((event) => event.stage)).toEqual([
      'delivered', undefined, undefined, undefined,
    ]);
  });

  it.each(carrier.capabilities)('declares %s and a fixture proves it', (capability) => {
    const check = checks[capability];
    expect(check, `unknown capability ${capability}`).toBeTypeOf('function');
    expect(check!(delivered)).toBe(true);
  });

  it('drops the recipient and the signature', () => {
    const projected = JSON.stringify(delivered);
    for (const value of ['Made Up Recipient', 'Example Street 1', 'proof-of-delivery']) {
      expect(projected).not.toContain(value);
    }
  });
});
