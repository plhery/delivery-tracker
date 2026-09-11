import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizePosMalaysiaTrackingNumber,
  parsePosMalaysiaTrackingResponse,
  PosMalaysiaTracker,
  PosMalaysiaTrackingError,
} from './posMalaysia';

// All identifiers, timestamps, offices and names below are synthetic. Event
// wordings and process summaries reuse the vendor's fixed English texts found
// in the official tracking bundle's own demo parcel, so classification
// exercises production prose rather than paraphrases.
const TRACKING_NUMBER = 'MYPM00000000015';

function detail(summary: string, process: string, date: string, eventType = 'EM001', office = 'Test Hub Shah Alam') {
  return { type: 'Valid', date, process, process_summary: summary, office, error_details: null, event_type: eventType, epod: '', reason: '' };
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    connote_id: TRACKING_NUMBER,
    sender_data: { sender_postcode: '50000', sender_state: 'KL', sender_city: 'KL', sender_country: 'MY', sender_phone: '+600000000000' },
    recipient_data: { receipient_postcode: '80000', receipient_state: 'JHR', receipient_city: 'JB', receipient_country: 'MY', receipient_phone: '+600000000001' },
    process_status: 'DELIVERED',
    eta_data: { summary: '', day: '', date: '', upper_eta: '', lower_eta: '' },
    tracking_data: [
      detail('Collected', 'We have received your parcel and can’t wait to deliver it!', '22 Feb 2026, 10:05:10 AM', 'EM001'),
      detail('On the way', 'Your parcel is on its way to our sorting facility', '22 Feb 2026, 05:34:58 PM', 'EM005'),
      detail('Sorting completed', 'Your parcel has been sorted. We are on our way!', '23 Feb 2026, 03:16:01 AM', 'EM010'),
      detail('Preparing for delivery', 'Your parcel is being sorted for delivery. We will deliver soon!', '23 Feb 2026, 08:20:50 AM', 'EM012'),
      detail('Out for delivery', 'Your parcel is with our courier and is out for delivery', '23 Feb 2026, 09:52:32 AM', 'EM014'),
      detail('Delivery completed', 'We have delivered your parcel. Thank you!', '23 Feb 2026, 01:40:28 PM', 'EM053'),
    ],
    ...overrides,
  };
}

function payload(items: unknown[]) {
  return { code: 'S0000', message: 'Success', data: items };
}

function response(value: unknown, status = 200) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('Pos Malaysia tracking normalization', () => {
  it('accepts MYPM barcodes and MY S10 identifiers and rejects the rest', () => {
    expect(normalizePosMalaysiaTrackingNumber('mypm00000000015')).toBe(TRACKING_NUMBER);
    expect(normalizePosMalaysiaTrackingNumber('RR157638464MY')).toBe('RR157638464MY');
    for (const raw of ['12345', 'Z8328162951', 'MYPM000000001', '']) {
      expect(() => normalizePosMalaysiaTrackingNumber(raw)).toThrow(TypeError);
    }
  });
});

describe('Pos Malaysia response parsing', () => {
  it('returns delivered history newest-first with Kuala Lumpur timestamps', () => {
    const result = parsePosMalaysiaTrackingResponse(payload([item()]), TRACKING_NUMBER);
    expect(result).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'We have delivered your parcel. Thank you!',
      last_update: '2026-02-23T13:40:28+08:00',
      expected_delivery: null,
      timezone: 'Asia/Kuala_Lumpur',
    });
    expect(result.events?.map((event) => [event.stage, event.time, event.location])).toEqual([
      ['delivered', '2026-02-23T13:40:28+08:00', 'Test Hub Shah Alam'],
      ['out_for_delivery', '2026-02-23T09:52:32+08:00', 'Test Hub Shah Alam'],
      ['in_transit', '2026-02-23T08:20:50+08:00', 'Test Hub Shah Alam'],
      ['in_transit', '2026-02-23T03:16:01+08:00', 'Test Hub Shah Alam'],
      ['in_transit', '2026-02-22T17:34:58+08:00', 'Test Hub Shah Alam'],
      ['accepted', '2026-02-22T10:05:10+08:00', 'Test Hub Shah Alam'],
    ]);
  });

  it('derives non-delivered status from the latest event', () => {
    const active = parsePosMalaysiaTrackingResponse(payload([item({
      process_status: 'IN TRANSIT',
      tracking_data: [detail('On the way', 'Moving', '22 Feb 2026, 05:34:58 PM', 'EM005')],
    })]), TRACKING_NUMBER);
    expect(active).toMatchObject({ status: 'in_transit', current_stage: 'in_transit' });
    const pickup = parsePosMalaysiaTrackingResponse(payload([item({
      process_status: '',
      tracking_data: [detail('Out for delivery', 'Courier', '23 Feb 2026, 09:52:32 AM', 'EM014')],
    })]), TRACKING_NUMBER);
    expect(pickup).toMatchObject({ status: 'out_for_delivery', current_stage: 'out_for_delivery' });
  });

  it('binds the echoed connote id and treats null history as not-found', () => {
    expect(() => parsePosMalaysiaTrackingResponse(payload([item({ connote_id: 'MYPM00000000017' })]), TRACKING_NUMBER))
      .toThrow(RangeError);
    expect(() => parsePosMalaysiaTrackingResponse(payload([item({ connote_id: undefined })]), TRACKING_NUMBER))
      .toThrow(RangeError);
    expect(() => parsePosMalaysiaTrackingResponse(payload([item({ tracking_data: null })]), TRACKING_NUMBER))
      .toThrow(PosMalaysiaTrackingError);
    // An authoritative DELIVERED overall stands even without event rows, while a
    // non-delivered item with no rows is the same unknown outcome as null history.
    expect(parsePosMalaysiaTrackingResponse(payload([item({ tracking_data: [] })]), TRACKING_NUMBER))
      .toMatchObject({ status: 'delivered', events: [] });
    expect(() => parsePosMalaysiaTrackingResponse(payload([item({ process_status: '', tracking_data: [] })]), TRACKING_NUMBER))
      .toThrow(PosMalaysiaTrackingError);
    expect(() => parsePosMalaysiaTrackingResponse(payload([]), TRACKING_NUMBER))
      .toThrow(RangeError);
    expect(() => parsePosMalaysiaTrackingResponse({ code: 'E9999', data: [] }, TRACKING_NUMBER))
      .toThrow(TypeError);
    expect(() => parsePosMalaysiaTrackingResponse(null, TRACKING_NUMBER)).toThrow(TypeError);
  });

  it('skips unusable rows without losing the shipment', () => {
    const result = parsePosMalaysiaTrackingResponse(payload([item({
      process_status: '',
      tracking_data: [
        detail('Delivery completed', 'Done', '23 Feb 2026, 01:40:28 PM', 'EM053'),
        detail('Delivery completed', 'Done', '23 Feb 2026, 01:40:28 PM', 'EM053'),
        detail('', '', '23 Feb 2026, 01:40:28 PM', 'EM053'),
        detail('Delivery completed', 'Done', 'not a date', 'EM053'),
        'not a record',
      ],
    })]), TRACKING_NUMBER);
    expect(result.events).toHaveLength(1);
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered' });
  });

  it('never retains sender, recipient or proof-of-delivery data', () => {
    const withEpod = item();
    (withEpod.tracking_data as Record<string, unknown>[])[0]!['epod'] = 'https://example.invalid/epod?token=secret';
    const result = parsePosMalaysiaTrackingResponse(payload([withEpod]), TRACKING_NUMBER);
    const serialized = JSON.stringify(result);
    for (const secret of ['+600000000000', '+600000000001', 'sender_data', 'recipient_data', 'epod', 'example.invalid']) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe('PosMalaysiaTracker fetch', () => {
  it('posts one connote id with a request id and maps HTTP outcomes', async () => {
    const seen: Array<{ url: string; body: string; requestId: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(input), body: String(init?.body), requestId: headers.get('P-Request-ID') ?? '' });
      return response(payload([item()]));
    });
    const result = await new PosMalaysiaTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER);
    expect(result.status).toBe('delivered');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://ttu-svc.pos.com.my/api/trackandtrace/v1/request');
    expect(JSON.parse(seen[0]!.body)).toEqual({ connote_ids: [TRACKING_NUMBER], culture: 'en' });
    expect(seen[0]!.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('surfaces transport and schema failures distinctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({}, 503));
    await expect(new PosMalaysiaTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toMatchObject({ name: 'UpstreamHttpError', status: 503 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response('not json', 200));
    await expect(new PosMalaysiaTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toThrow(TypeError);
    expect(() => new PosMalaysiaTracker({ timeoutMs: 0 })).toThrow(TypeError);
    await expect(new PosMalaysiaTracker({ timeoutMs: 1_000 }).fetch('nope'))
      .rejects.toThrow(TypeError);
  });
});
