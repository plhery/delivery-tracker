import 'server-only';

/**
 * Postal Ninja (postal.ninja), an opt-in universal aggregator.
 *
 * Transport: TRAWL (or local Chromium when unconfigured) submits the embedded tracking
 * widget on `/en/tools` and reads the `/track/get` response it produces.
 * Opening a URL that contains the number does not perform a lookup, and the
 * main tracking page can require an interactive challenge, so the widget is
 * the only unattended path found so far. The provider is disabled by default;
 * `TRACKING_ENABLE_POSTAL_NINJA=true` puts it in the chain before 17TRACK.
 */
import { DateTime } from 'luxon';
import type { AdapterFactory } from '../../core/adapter';
import { ChallengeError, IndeterminateError, SchemaError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import type { StepRecorder } from '../../core/telemetry';
import type { TrawlClient } from '../../core/transport';
import { scrapeUniversalPage, type UniversalBrowserOptions } from '../../core/transport/browser';
import { isRecord } from '../../core/types';
import { capturedBodies, captureFailure, loadCapture, type CaptureSpec } from '../shared/capture';
import { event, eventStage, hasPrivateDeliveryDetails, isNotice, numberOf, result, text, type UniversalSource } from '../shared/result';

const SOURCE: UniversalSource = 'Postal Ninja';
const GET_API = 'https://postal.ninja/track/get';
const CHECK_API = 'https://postal.ninja/track/check';
const MAX_EVENTS = 1000;
/** The states whose history the provider considers established. */
const TRACKED_STATES = ['TRACKING', 'FINISHED', 'STOPPED', 'ARCHIVED'];

export function parsePostalNinjaResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const number = numberOf(trackingNumber);
  if (!isRecord(payload) || payload.status !== 'FOUND' || !isRecord(payload.track)
    || payload.track.tc !== number || payload.track.hid !== payload.hid
    || typeof payload.hid !== 'string' || !payload.hid
    || !TRACKED_STATES.includes(String(payload.track.state))) {
    throw new SchemaError(SOURCE, 'Postal Ninja has no matching shipment history');
  }
  // The embedded widget requests compact:true, which supplies only the first
  // and latest scan. Full /track/get responses instead carry events[].
  const rawEvents = payload.track.events === undefined
    ? [payload.track.firstEv, payload.track.lastEv].filter((value) => value != null)
    : payload.track.events;
  if (!Array.isArray(rawEvents) || rawEvents.length > MAX_EVENTS) throw new SchemaError(SOURCE, 'Postal Ninja returned invalid events');
  const events: CarrierEvent[] = [];
  // Postal Ninja supplies events oldest first. Its dt values are local wall
  // times without a zone, even when multiple countries are involved. Preserve
  // them as local_time, but never invent UTC scans or use the destination zone
  // for the whole journey. Explicit offsets, when present, can be persisted.
  for (const raw of [...rawEvents].reverse()) {
    if (!isRecord(raw)) throw new SchemaError(SOURCE, 'Postal Ninja returned an invalid event');
    const description = text(raw.dsc);
    if (!description || isNotice(description)) continue;
    if (typeof raw.dt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?/.test(raw.dt)
      || !DateTime.fromISO(raw.dt, { zone: 'UTC' }).isValid) throw new SchemaError(SOURCE, 'Postal Ninja returned an invalid event date');
    if (/(?:Z|[+-]\d{2}:\d{2})$/.test(raw.dt)) {
      const parsed = event(raw.dt, description);
      if (parsed) events.push(parsed);
    } else {
      const stage = eventStage(description) ?? 'pending';
      if (stage !== 'delivered' && hasPrivateDeliveryDetails(description)) continue;
      events.push({ local_time: raw.dt, description: stage === 'delivered' ? 'Delivered' : description, stage });
    }
  }
  return result(events, SOURCE, true);
}

export interface PostalNinjaOptions extends UniversalBrowserOptions {
  trawl?: TrawlClient | null;
  fetcher?: typeof fetch;
  recorder?: StepRecorder;
}

export class PostalNinjaTracker {
  constructor(readonly options: PostalNinjaOptions = {}) {}

  async fetch(trackingNumber: string, budgetMs?: number): Promise<CarrierResult> {
    const number = numberOf(trackingNumber);
    const timeoutMs = budgetMs ?? this.options.timeoutMs ?? 45_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new TypeError('Postal Ninja timeout must be between 1 and 60000 ms');
    let handle: string | undefined;
    const responseError = (payload: unknown): Error | undefined => {
      if (!isRecord(payload)) return;
      if (payload.tc === number && payload.status === 'PROCESSING' && typeof payload.hid === 'string' && payload.hid) {
        handle = payload.hid;
      }
      if (payload.status === 'CHLNG_REQ' && (payload.tc === number || (handle && payload.hid === handle))) {
        return new ChallengeError(SOURCE, 'Postal Ninja browser verification did not complete');
      }
      if (payload.status === 'UNTRACEABLE' && payload.tc === number) {
        return new IndeterminateError(SOURCE, 'Postal Ninja cannot track this number');
      }
      if (payload.status === 'FOUND' && isRecord(payload.track) && payload.track.tc === number
        && typeof payload.hid === 'string' && payload.hid && payload.track.hid === payload.hid
        && payload.track.state === 'NO_INFO' && !payload.inProgress) {
        return new IndeterminateError(SOURCE, 'Postal Ninja has no available tracking history');
      }
    };
    return runSteps({ carrier: SOURCE, budgetMs: timeoutMs, recorder: this.options.recorder }, [{
      id: 'trawl', enabled: Boolean(this.options.trawl),
      run: async ({ remainingMs }) => {
        const spec: CaptureSpec = {
          source: SOURCE, url: `https://postal.ninja/en/tools#trawl-number=${number}`,
          apiUrl: GET_API, additionalApiUrls: [CHECK_API], budgetMs: remainingMs, fetcher: this.options.fetcher,
        };
        const page = await loadCapture(this.options.trawl ?? null, spec);
        // Learn the submission's handle before interpreting a handle-only
        // retrieval challenge. Read history newest first to skip polling.
        let submissionError: Error | undefined;
        for (const body of [...capturedBodies(page, { ...spec, apiUrl: CHECK_API })].reverse()) {
          let payload: unknown;
          try { payload = JSON.parse(body); } catch { continue; }
          submissionError = responseError(payload) ?? submissionError;
        }
        let pending: Error | undefined;
        for (const body of capturedBodies(page, spec)) {
          let payload: unknown;
          try { payload = JSON.parse(body); } catch { continue; }
          const error = responseError(payload);
          if (error) throw error;
          try { return parsePostalNinjaResponse(payload, number); }
          catch (error) { if (error instanceof SchemaError) pending ??= error; else throw error; }
        }
        throw submissionError ?? pending ?? captureFailure(page, spec);
      },
    }, {
      id: 'browser',
      // A failed TRAWL attempt proceeds to the next universal provider. Do
      // not spend another browser budget on the known-unreliable Chromium path.
      enabled: !this.options.trawl,
      run: ({ remainingMs }) => scrapeUniversalPage({ executablePath: this.options.executablePath, timeoutMs: Math.max(1, Math.floor(remainingMs)) }, {
        name: SOURCE, url: 'https://postal.ninja/en/tools', responseUrl: 'https://postal.ninja/track/get',
        responseErrors: {
          'https://postal.ninja/track/check': responseError,
          'https://postal.ninja/track/get': responseError,
        },
        submit: async (page) => {
          // The official embedded widget uses an automatic browser check. The
          // main tracking page can instead require an interactive challenge.
          const form = page.frameLocator('iframe[title="Package tracking widget"]').locator('form.tracker');
          await form.locator('input[type="text"]').fill(number);
          const save = form.locator('input[type="checkbox"]');
          if (await save.count()) await save.uncheck();
          await form.locator('button[type="submit"]').click();
        },
      }, (payload) => parsePostalNinjaResponse(payload, number)),
    }]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new PostalNinjaTracker({
    trawl: environment.trawl, fetcher: environment.fetcher,
    executablePath: environment.browserExecutablePath ?? undefined,
    recorder: environment.recorder,
  });
  return {
    id: SOURCE,
    steps: [environment.trawl ? 'trawl' : 'browser'],
    track: (input, context) => tracker.fetch(input.number, context?.budgetMs),
  };
};
