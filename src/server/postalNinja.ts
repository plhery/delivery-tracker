import 'server-only';

import { DateTime } from 'luxon';
import type { CarrierEvent, CarrierResult } from './carrierResult';
import { isRecord } from './types';
import { scrapeUniversalPage, type UniversalBrowserOptions } from './universalBrowser';
import { event, eventStage, hasPrivateDeliveryDetails, isNotice, numberOf, result, text } from './universalTrackingResult';

export function parsePostalNinjaResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const number = numberOf(trackingNumber);
  if (!isRecord(payload) || payload.status !== 'FOUND' || !isRecord(payload.track)
    || payload.track.tc !== number || payload.track.hid !== payload.hid
    || typeof payload.hid !== 'string' || !payload.hid
    || !['TRACKING', 'FINISHED', 'STOPPED', 'ARCHIVED'].includes(String(payload.track.state))) {
    throw new TypeError('Postal Ninja has no matching shipment history');
  }
  const rawEvents = payload.track.events;
  if (!Array.isArray(rawEvents) || rawEvents.length > 1000) throw new TypeError('Postal Ninja returned invalid events');
  const events: CarrierEvent[] = [];
  // Postal Ninja supplies events oldest first. Its dt values are local wall
  // times without a zone, even when multiple countries are involved. Preserve
  // them as local_time, but never invent UTC scans or use the destination zone
  // for the whole journey. Explicit offsets, when present, can be persisted.
  for (const raw of [...rawEvents].reverse()) {
    if (!isRecord(raw)) throw new TypeError('Postal Ninja returned an invalid event');
    const description = text(raw.dsc);
    if (!description || isNotice(description)) continue;
    if (typeof raw.dt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?/.test(raw.dt)
      || !DateTime.fromISO(raw.dt, { zone: 'UTC' }).isValid) throw new TypeError('Postal Ninja returned an invalid event date');
    if (/(?:Z|[+-]\d{2}:\d{2})$/.test(raw.dt)) {
      const parsed = event(raw.dt, description);
      if (parsed) events.push(parsed);
    } else {
      const stage = eventStage(description) ?? 'pending';
      if (stage !== 'delivered' && hasPrivateDeliveryDetails(description)) continue;
      events.push({ local_time: raw.dt, description: stage === 'delivered' ? 'Delivered' : description, stage });
    }
  }
  return result(events, 'Postal Ninja', true);
}

export class PostalNinjaTracker {
  constructor(readonly options: UniversalBrowserOptions = {}) {}

  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const number = numberOf(trackingNumber);
    return scrapeUniversalPage(this.options, {
      name: 'Postal Ninja', url: 'https://postal.ninja/en/tools', responseUrl: 'https://postal.ninja/track/get',
      submit: async (page) => {
        // The official embedded widget uses an automatic browser check. The
        // main tracking page can instead require an interactive challenge.
        const form = page.frameLocator('iframe[title="Package tracking widget"]').locator('form.tracker');
        await form.locator('input[type="text"]').fill(number);
        const save = form.locator('input[type="checkbox"]');
        if (await save.count()) await save.uncheck();
        await form.locator('button[type="submit"]').click();
      },
    }, (payload) => parsePostalNinjaResponse(payload, number));
  }
}
