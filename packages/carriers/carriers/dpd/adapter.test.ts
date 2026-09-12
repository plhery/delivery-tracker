import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StepRecord, StepRecorder } from '../../core/telemetry';
import {
  DPDChallengeError,
  DPDTracker,
  DPDTrackingError,
  adapter,
  parseDPDTrackingApi,
} from './adapter';
import { apiStage, apiStatus, wordingStatus } from './status';

// Every identifier below is synthetic: a 14-digit number that matches DPD's
// shape but was never issued, and made-up names for the private fields the
// projection has to drop.
const TRACKING_NUMBER = '06080000000001';
const READY_FOR_COLLECTION = JSON.parse(
  readFileSync(new URL('./fixtures/ready-for-collection.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const CAPABILITIES = (JSON.parse(
  readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
) as { capabilities: string[] }).capabilities;

function recordingRecorder(): { recorder: StepRecorder; steps: StepRecord[] } {
  const steps: StepRecord[] = [];
  return { steps, recorder: { step: (record) => { steps.push(record); }, lookup() {} } };
}

/** The four guest-API calls a cold tracker makes before it reads the parcel. */
function mockGuestApi(details: Response) {
  return vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ fid: 'unit-test-fid', authToken: { token: 'installation-token', expiresIn: '604800s' } }))
    .mockResolvedValueOnce(Response.json({ entries: { basic_dpd_token: 'dW5pdDp0ZXN0' } }))
    .mockResolvedValueOnce(Response.json({ access_token: 'unit-test-access-token', expires_in: 3600 }))
    .mockResolvedValueOnce(details);
}

afterEach(() => vi.restoreAllMocks());

describe('DPD guest API projection', () => {
  it('returns every declared capability from one fixture', () => {
    const result = parseDPDTrackingApi(READY_FOR_COLLECTION, TRACKING_NUMBER, true);

    expect(CAPABILITIES).toEqual(['history', 'location', 'eta', 'sender_name', 'pickup_point']);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some((event) => event.location)).toBe(true);
    expect(result.expected_delivery).toBe('2026-07-16 09:00–12:00');
    expect(result.sender_name).toBe('Example Webshop AG');
    expect(result.pickup_point).toBe('Pickup parcelshop Zürich Wiedikon');
  });

  it('drops recipient identity, address, phone and signature', () => {
    const serialized = JSON.stringify(parseDPDTrackingApi(READY_FOR_COLLECTION, TRACKING_NUMBER));

    for (const privateValue of [
      'Private Recipient', 'Private Street 7', '+41000000000', 'signature image',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('maps the collection milestone and keeps the delivery window out of the stage', () => {
    const result = parseDPDTrackingApi(READY_FOR_COLLECTION, TRACKING_NUMBER, false);

    expect(result).toMatchObject({
      status: 'out_for_delivery',
      current_stage: 'ready_for_pickup',
      last_status_text: 'Ready for collection at the Pickup parcelshop',
      last_update: '2026-07-16T08:12:00+02:00',
      dpd_postcode_verified: false,
    });
    expect(result.events?.[2]).toMatchObject({
      location: 'Urdorf, CH',
      description: 'Parcel handed to DPD',
    });
  });
});

describe('DPD status vocabulary', () => {
  it('maps the enumeration values that are unambiguous and leaves the rest unmapped', () => {
    expect(apiStage('DELIVERED')).toBe('delivered');
    expect(apiStage('RETURN_TO_SENDER')).toBe('returned');
    expect(apiStage('UNSUCCESSFUL_DELIVERY_ATTEMPT')).toBe('failed_attempt');
    // Movement through the network has no milestone of its own.
    for (const key of ['PARCEL_HANDED', 'IN_TRANSIT', 'AT_DELIVERY_CENTER', 'OTHER']) {
      expect(apiStage(key)).toBeNull();
    }
  });

  it('treats a failed attempt as a retry and a return as an exception', () => {
    expect(apiStatus('UNSUCCESSFUL_DELIVERY_ATTEMPT', '', true)).toBe('in_transit');
    expect(apiStatus('RETURN_TO_SENDER', '', true)).toBe('exception');
    expect(apiStatus('UNKNOWN_KEY', 'Zugestellt', true)).toBe('delivered');
  });

  it('classifies the rendered page in the four portal languages', () => {
    expect(wordingStatus('Consegnato', false)).toBe('delivered');
    expect(wordingStatus('En cours de livraison', false)).toBe('out_for_delivery');
    expect(wordingStatus('Data received', false)).toBe('pending');
    expect(wordingStatus('Something we do not know', false)).toBe('unknown');
  });
});

describe('DPDTracker steps', () => {
  it('serves the lookup from the direct guest protocol and records one step', async () => {
    const fetcher = mockGuestApi(Response.json(READY_FOR_COLLECTION));
    const { recorder, steps } = recordingRecorder();

    const result = await new DPDTracker({ timeoutMs: 1_000, trawl: null, recorder })
      .fetch(TRACKING_NUMBER, '8004');

    expect(result).toMatchObject({ status: 'out_for_delivery' });
    expect(result.tracking_url).toContain(TRACKING_NUMBER);
    expect(steps.map((step) => [step.step, step.outcome])).toEqual([['direct', 'ok']]);
    expect(String(fetcher.mock.calls[3]?.[0])).toContain('dataForVerification=8004');
  });

  it('retries without verification when DPD rejects the postcode, and says so', async () => {
    const fetcher = mockGuestApi(new Response('', { status: 400 }))
      .mockResolvedValueOnce(Response.json(READY_FOR_COLLECTION));

    const result = await new DPDTracker({ timeoutMs: 1_000, trawl: null })
      .fetch(TRACKING_NUMBER, '9999');

    expect(result.dpd_postcode_verified).toBe(false);
    expect(String(fetcher.mock.calls[4]?.[0])).toContain('continueWithoutVerification=true');
    expect(String(fetcher.mock.calls[4]?.[0])).not.toContain('9999');
  });

  it('falls back to the rendered page and records the recovery as the page step', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<html>maintenance</html>'))
      .mockResolvedValueOnce(new Response(`
        <html><body>
          <div>${TRACKING_NUMBER}</div>
          <li class="content-item-track">
            <span class="entry-date">15.07.2026</span>
            <span class="entry-time">11:28</span>
            <span class="entry-body">Parcel handed to DPD</span>
          </li>
        </body></html>
      `));
    const { recorder, steps } = recordingRecorder();

    await expect(new DPDTracker({ timeoutMs: 1_000, trawl: null, recorder }).fetch(TRACKING_NUMBER))
      .resolves.toMatchObject({ status: 'in_transit' });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(steps.map((step) => step.step)).toEqual(['direct', 'page']);
    expect(steps[1]).toMatchObject({ fallbackFrom: 'direct', fallbackReason: 'indeterminate' });
  });

  it('keeps a positive unknown parcel out of the page fallback', async () => {
    const fetcher = mockGuestApi(new Response('', { status: 404 }));
    const { recorder, steps } = recordingRecorder();

    await expect(new DPDTracker({ timeoutMs: 1_000, trawl: null, recorder }).fetch(TRACKING_NUMBER))
      .rejects.toBeInstanceOf(DPDTrackingError);

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(steps.map((step) => [step.step, step.outcome])).toEqual([['direct', 'not_found']]);
  });

  it('asks for a browser solver when the page itself is challenged', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<html>maintenance</html>'))
      .mockResolvedValueOnce(new Response('<title>Just a moment...</title>', {
        status: 403, headers: { 'CF-Mitigated': 'challenge' },
      }));

    await expect(new DPDTracker({ timeoutMs: 1_000, trawl: null }).fetch(TRACKING_NUMBER))
      .rejects.toThrow('configure FLARESOLVERR_URL');
  });

  it('solves the page through the browser service when one is configured', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<html>maintenance</html>'))
      .mockResolvedValueOnce(Response.json({
        status: 'ok',
        solution: {
          status: 200,
          response: `<html><body><div>${TRACKING_NUMBER}</div>
            <li class="content-item-track"><span class="entry-date">15.07.2026</span>
            <span class="entry-body">Parcel handed to DPD</span></li></body></html>`,
        },
      }));

    await expect(new DPDTracker({ timeoutMs: 1_000, flaresolverrUrl: 'http://trawl.internal:8191' })
      .fetch(TRACKING_NUMBER)).resolves.toMatchObject({ status: 'in_transit' });

    expect(String(fetcher.mock.calls[1]?.[0])).toBe('http://trawl.internal:8191/v1');
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
      cmd: 'request.get',
      maxTimeout: 1_000,
    });
  });

  it('reports a Cloudflare challenge with the shared challenge status', () => {
    expect(new DPDChallengeError()).toMatchObject({ kind: 'challenge', status: 403, provider: 'DPD' });
  });
});

describe('DPD adapter factory', () => {
  it('declares both tiers and forwards the postcode as the tracking credential', async () => {
    const fetcher = mockGuestApi(Response.json(READY_FOR_COLLECTION));
    const { recorder } = recordingRecorder();
    const instance = adapter({
      trawl: null, browserExecutablePath: null, recorder, env: {},
    });

    expect(instance.id).toBe('dpd');
    expect(instance.steps).toEqual(['direct', 'page']);
    await expect(instance.track({ number: TRACKING_NUMBER, postcode: '8004' }))
      .resolves.toMatchObject({ status: 'out_for_delivery' });
    expect(String(fetcher.mock.calls[3]?.[0])).toContain('dataForVerification=8004');
  });
});

describe('DPD transient read retry', () => {
  it('retries a parcel-details 503 once without repeating authentication', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetcher = mockGuestApi(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json(READY_FOR_COLLECTION));
    await expect(new DPDTracker({ timeoutMs: 5_000, trawl: null }).fetch(TRACKING_NUMBER))
      .resolves.toMatchObject({ status: 'out_for_delivery' });
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(String(fetcher.mock.calls[3]![0])).toEqual(String(fetcher.mock.calls[4]![0]));
  });
  it('does not spend the retry delay when the request budget is nearly exhausted', async () => {
    const fetcher = mockGuestApi(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(`<div>${TRACKING_NUMBER}</div>`));
    await new DPDTracker({ timeoutMs: 1_000, trawl: null }).fetch(TRACKING_NUMBER).catch(() => undefined);
    expect(String(fetcher.mock.calls[4]![0])).not.toEqual(String(fetcher.mock.calls[3]![0]));
  });
});
