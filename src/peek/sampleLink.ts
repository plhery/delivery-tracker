import type { Locale } from '../lib/locale';
import { currentEvent, latestEvent } from '../lib/stages';
import { uid } from '../lib/uid';
import { demoWording, nextStage, seedParcels, SIMULATED_UPDATES } from '../store/demoRepo';
import type { ParcelWithEvents } from '../types';
import type { ParcelLinkReadOptions, ParcelLinkView } from './linkModel';
import { SAMPLE_LINK_ID } from './sample';

/** The demo's parcel the sample tells: on its way, with two scans still to come. */
const STORY = 'DEMOGLS20260001';

/** The sample as told so far, in the demo's English. It lasts as long as the page. */
let told: ParcelWithEvents | null = null;

function begin(now: number): ParcelWithEvents {
  const samples = seedParcels(now);
  const story = samples.find((parcel) => parcel.trackingNumber === STORY) ?? samples[0];
  return { ...story, id: SAMPLE_LINK_ID, events: story.events.map((event) => ({ ...event, parcelId: SAMPLE_LINK_ID })) };
}

/** One more scan, the way the demo deliveries move on a refresh. */
function advanced(parcel: ParcelWithEvents, now: number): ParcelWithEvents {
  const current = currentEvent(parcel.events);
  const next = current && nextStage(current.stage);
  if (!next) return parcel;
  const occurredAt = new Date(Math.max(now, Date.parse(latestEvent(parcel.events)!.occurredAt) + 1_000)).toISOString();
  return { ...parcel, events: [...parcel.events, { id: uid(), parcelId: parcel.id, stage: next, occurredAt, ...SIMULATED_UPDATES[next] }] };
}

/** The demo's text in the reader's language; in English where its translation cannot be loaded. */
async function wording(locale: Locale): Promise<(text: string) => string> {
  try {
    return await demoWording(locale);
  } catch {
    return (text) => text;
  }
}

/** Starts the story over: each time the sample is opened from the landing, it is told from its beginning. */
export function restartSample(): void {
  told = null;
}

/**
 * Reads the sample as the owner of a lookup would read their parcel, without a
 * key: it can be looked at, named and shared, never kept or forgotten.
 * `advance` moves its story one scan on; `locale` is the language it is told in.
 */
export async function readSampleLink({ advance = false, signal, locale = 'en' }: ParcelLinkReadOptions = {}, now = Date.now()): Promise<ParcelLinkView> {
  signal?.throwIfAborted();
  told ??= begin(now);
  if (advance) told = advanced(told, now);
  const parcel = { ...told, lastSyncedAt: new Date(now).toISOString() };
  const say = await wording(locale);
  return {
    link: {
      id: SAMPLE_LINK_ID, role: 'owner', kind: 'lookup', createdAt: parcel.createdAt, forgetAt: null,
      numberShown: true, showNumber: false, canKeep: false, gift: false, shared: true,
      // No push service stands behind the sample: an alert is only remembered by this browser.
      alerts: { available: true, vapidPublicKey: null },
    },
    parcel: {
      ...parcel,
      label: say(parcel.label),
      events: parcel.events.map((event) => ({ ...event, description: say(event.description), location: event.location && say(event.location) })),
    },
    numberHint: null,
  };
}
