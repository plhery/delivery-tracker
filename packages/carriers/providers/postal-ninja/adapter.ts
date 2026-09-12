import 'server-only';

/**
 * Postal Ninja (postal.ninja), an opt-in universal aggregator.
 *
 * Transport: a local Chromium session submits the official embedded tracking
 * widget on `/en/tools` and reads the `/track/get` response it produces.
 * Opening a URL that contains the number does not perform a lookup, and the
 * main tracking page can require an interactive challenge, so the widget is
 * the only unattended path found so far. The provider is disabled by default;
 * `TRACKING_ENABLE_POSTAL_NINJA=true` puts it in the chain before 17TRACK.
 */
import { DateTime } from 'luxon';
import type { AdapterFactory } from '../../core/adapter';
import { SchemaError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import type { StepRecorder } from '../../core/telemetry';
import { scrapeUniversalPage, type UniversalBrowserOptions } from '../../core/transport/browser';
import { isRecord } from '../../core/types';
import { event, eventStage, hasPrivateDeliveryDetails, isNotice, numberOf, result, text, type UniversalSource } from '../shared/result';

const SOURCE: UniversalSource = 'Postal Ninja';
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
  const rawEvents = payload.track.events;
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
  recorder?: StepRecorder;
}

export class PostalNinjaTracker {
  constructor(readonly options: PostalNinjaOptions = {}) {}

  async fetch(trackingNumber: string, budgetMs?: number): Promise<CarrierResult> {
    const number = numberOf(trackingNumber);
    const timeoutMs = budgetMs ?? this.options.timeoutMs ?? 45_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new TypeError('Postal Ninja timeout must be between 1 and 60000 ms');
    return runSteps({ carrier: SOURCE, budgetMs: timeoutMs, recorder: this.options.recorder }, [{
      id: 'browser',
      run: ({ remainingMs }) => scrapeUniversalPage({ executablePath: this.options.executablePath, timeoutMs: Math.max(1, Math.floor(remainingMs)) }, {
        name: SOURCE, url: 'https://postal.ninja/en/tools', responseUrl: 'https://postal.ninja/track/get',
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
    executablePath: environment.browserExecutablePath ?? undefined,
    recorder: environment.recorder,
  });
  return {
    id: SOURCE,
    steps: ['browser'],
    track: (input, context) => tracker.fetch(input.number, context?.budgetMs),
  };
};
