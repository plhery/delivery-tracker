import { carrierBrandFamily } from '../brand';
import { normalizeTrackingNumber, parseTrackingInput } from '../lib/carriers';
import { currentEvent, isFinal, latestEvent } from '../lib/stages';
import { uid } from '../lib/uid';
import { browserStorage } from '../store/apiRepo';
import { nextStage, seedParcels, SIMULATED_UPDATES } from '../store/demoRepo';
import type { CarrierId, ParcelWithEvents, TrackingEvent } from '../types';
import {
  isParcelLinkId,
  PARCEL_LINK_ID_ALPHABET,
  ParcelLinkError,
  type ParcelLinksClient,
  type ParcelLinkView,
  type ParcelNumberHint,
} from './linkModel';

export const DEMO_LINKS_STORAGE_KEY = 'sdt.peek.demo.v1'; // gitleaks:allow -- public localStorage name
/** The story of a number whose carrier has none of its own. */
const DEFAULT_STORY = 'DEMOGLS20260001';
/** A lookup answers before its first check, as the server's does; the first read after this shows the story. */
const FIRST_CHECK_MS = 1_500;
const DAY = 86_400_000;

interface DemoLink {
  key: string;
  createdAt: string;
  openedAt: string;
  /** What the link shows now. */
  parcel: ParcelWithEvents;
  /** The story the first check brings, and when. */
  arriving?: { at: number; parcel: ParcelWithEvents };
}
type DemoLinks = Record<string, DemoLink>;

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** An id in the server's format, drawn without modulo bias. */
function newLinkId(): string {
  const size = PARCEL_LINK_ID_ALPHABET.length;
  const limit = 256 - (256 % size);
  let id = '';
  while (id.length < 12) {
    for (const byte of randomBytes(24)) {
      if (byte < limit && id.length < 12) id += PARCEL_LINK_ID_ALPHABET[byte % size];
    }
  }
  return id;
}

/** 43 base64url characters, like a server key. */
function newOwnerKey(): string {
  return btoa(String.fromCharCode(...randomBytes(32))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function numberHint(trackingNumber: string): ParcelNumberHint {
  const head = Math.min(4, Math.floor(trackingNumber.length / 3));
  const tail = Math.min(3, Math.floor(trackingNumber.length / 4));
  return { head: trackingNumber.slice(0, head), tail: trackingNumber.slice(trackingNumber.length - tail) };
}

/**
 * The story of a number: a sample's own when the number is one of the demo's,
 * else one still on its way, told for this carrier when the samples have one.
 */
function story(trackingNumber: string, carrier: CarrierId | undefined, now: number): ParcelWithEvents {
  const samples = seedParcels(now);
  const underway = samples.filter((parcel) => {
    const stage = currentEvent(parcel.events)?.stage;
    return !parcel.archivedAt && stage && !isFinal(stage);
  });
  return samples.find((parcel) => parcel.trackingNumber === trackingNumber && (!carrier || parcel.carrier === carrier))
    ?? underway.find((parcel) => parcel.carrier === carrier)
    ?? underway.find((parcel) => carrier && carrierBrandFamily(parcel.carrier) === carrierBrandFamily(carrier))
    ?? samples.find((parcel) => parcel.trackingNumber === DEFAULT_STORY)
    ?? samples[0];
}

function simulated(parcelId: string, stage: TrackingEvent['stage'], occurredAt: string): TrackingEvent {
  return { id: uid(), parcelId, stage, occurredAt, ...SIMULATED_UPDATES[stage] };
}

/**
 * Parcel links of a build without an API: fictional parcels told from the
 * demo's stories, kept in this browser. Nothing leaves the device.
 */
export function createDemoLinks(
  storage: Storage | null = browserStorage(),
  now: () => number = Date.now,
): ParcelLinksClient {
  // Without usable storage (private browsing) the links live as long as the page.
  let memory: DemoLinks = {};
  let inMemory = !storage;

  function load(): DemoLinks {
    if (inMemory) return memory;
    try {
      const raw = storage!.getItem(DEMO_LINKS_STORAGE_KEY);
      const value: unknown = raw ? JSON.parse(raw) : null;
      return value && typeof value === 'object' && !Array.isArray(value) ? value as DemoLinks : {};
    } catch {
      return memory;
    }
  }

  function save(links: DemoLinks) {
    memory = links;
    try {
      storage!.setItem(DEMO_LINKS_STORAGE_KEY, JSON.stringify(links));
      inMemory = false;
    } catch {
      inMemory = true;
    }
  }

  /** The same rule as the server's: 30 days after the end of the journey, else 90 days after the last sign of life. */
  function forgetAt(link: DemoLink): string {
    const current = currentEvent(link.parcel.events);
    const created = Date.parse(link.createdAt);
    const time = current && isFinal(current.stage)
      ? Math.max(Date.parse(current.occurredAt), created) + 30 * DAY
      : Math.max(Date.parse(latestEvent(link.parcel.events)?.occurredAt ?? link.createdAt), Date.parse(link.openedAt), created) + 90 * DAY;
    return new Date(time).toISOString();
  }

  function view(id: string, link: DemoLink, owner: boolean): ParcelLinkView {
    const { trackingNumber } = link.parcel;
    return {
      link: {
        id, role: owner ? 'owner' : 'viewer', kind: 'lookup', createdAt: link.createdAt,
        forgetAt: forgetAt(link), numberShown: owner, canKeep: owner,
      },
      parcel: owner ? link.parcel : { ...link.parcel, trackingNumber: '' },
      numberHint: owner ? null : numberHint(trackingNumber),
    };
  }

  /** One more scan, the way the demo deliveries move on a refresh. */
  function advanced(parcel: ParcelWithEvents): ParcelWithEvents {
    const current = currentEvent(parcel.events);
    const next = current && nextStage(current.stage);
    if (!current || !next) return parcel;
    const occurredAt = new Date(Math.max(now(), Date.parse(latestEvent(parcel.events)!.occurredAt) + 1_000)).toISOString();
    return {
      ...parcel,
      lastSyncedAt: new Date(now()).toISOString(),
      events: [...parcel.events, simulated(parcel.id, next, occurredAt)],
    };
  }

  return {
    mode: 'demo',

    async detectCarrierPublic(trackingNumber, signal) {
      signal?.throwIfAborted();
      return { trackingNumber: normalizeTrackingNumber(trackingNumber), carrier: parseTrackingInput(trackingNumber).carrier };
    },

    async lookupParcel(input, signal) {
      signal?.throwIfAborted();
      const trackingNumber = normalizeTrackingNumber(input.trackingNumber);
      if (!/^(?=.*\d)(?:[A-Z0-9]{4,40}|\d{4}\/\d{8})$/.test(trackingNumber)) {
        throw new ParcelLinkError('validation', { guidance: 'error.trackingNumber' });
      }
      const time = now();
      const createdAt = new Date(time).toISOString();
      const detected = input.carrier ?? parseTrackingInput(trackingNumber).carrier;
      const known = detected === 'unknown' ? undefined : detected;
      const told = story(trackingNumber, known, time);
      const parcel: ParcelWithEvents = {
        ...told,
        id: uid(),
        trackingNumber,
        label: '',
        carrier: known ?? told.carrier,
        createdAt,
        dpdPostcode: undefined,
        archivedAt: undefined,
        lastSyncedAt: new Date(time + FIRST_CHECK_MS).toISOString(),
      };
      parcel.events = told.events.map((event) => ({ ...event, parcelId: parcel.id }));
      const link: DemoLink = {
        key: newOwnerKey(),
        createdAt,
        openedAt: createdAt,
        parcel: {
          id: parcel.id, trackingNumber, label: '', carrier: parcel.carrier, createdAt, syncStatus: 'pending',
          events: [simulated(parcel.id, 'pending', createdAt)],
        },
        arriving: { at: time + FIRST_CHECK_MS, parcel },
      };
      const id = newLinkId();
      save({ ...load(), [id]: link });
      return { id, key: link.key, view: view(id, link, true) };
    },

    async readParcelLink(id, { key, signal, advance = false } = {}) {
      signal?.throwIfAborted();
      const links = load();
      let link = isParcelLinkId(id) && Object.hasOwn(links, id) ? links[id] : null;
      if (!link) return 'unavailable';
      const time = now();
      if (time > Date.parse(forgetAt(link))) {
        const { [id]: forgotten, ...kept } = links;
        void forgotten;
        save(kept);
        return 'unavailable';
      }
      const before = link;
      if (link.arriving && (advance || time >= link.arriving.at)) link = { ...link, parcel: link.arriving.parcel, arriving: undefined };
      else if (advance) link = { ...link, parcel: advanced(link.parcel) };
      // Like the server, an open link moves its last-opened time at most every five minutes.
      if (time - Date.parse(link.openedAt) > 5 * 60_000) link = { ...link, openedAt: new Date(time).toISOString() };
      if (link !== before) save({ ...links, [id]: link });
      return view(id, link, key === link.key);
    },

    async forgetParcelLink(id, key) {
      const { [id]: link, ...kept } = load();
      if (!link || link.key !== key) throw new ParcelLinkError('unavailable');
      save(kept);
    },
  };
}
