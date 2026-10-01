import demoSamples from '../../shared/delivery-demo.json';
import {
  detectCarrier,
  normalizeTrackingNumber,
  supportsSwissPostHandoff,
} from '../lib/carriers';
import { isLocale, type Locale } from '../lib/locale';
import { currentStage, isFinal, latestEvent } from '../lib/stages';
import { uid } from '../lib/uid';
import {
  ParcelAlreadyExistsError,
  type EventPlace,
  type NewParcelInput,
  type ParcelCarrierInput,
  type ParcelRepo,
  type ParcelWithEvents,
  type Stage,
  type TrackingEvent,
} from '../types';

export const DEMO_STORAGE_KEY = 'sdt.demo.parcels.v1';

/** One sample parcel of the demo, timed relative to the moment it is seeded. */
interface DemoSample {
  label: string;
  trackingNumber: string;
  carrier: string;
  expectedInDays?: number;
  archivedHoursAgo?: number;
  senderName?: string;
  pickupPoint?: string;
  weightKg?: number;
  events: { stage: string; hoursAgo: number; description: string; location?: string; place?: unknown }[];
}

const demoCatalog: DemoSample[] = demoSamples;
const HOUR = 3_600_000;
const CATALOG_KEY = 'sdt.demo.catalog.v2';
/** The language the saved demo text is written in; English when absent. */
const LANGUAGE_KEY = 'sdt.demo.language.v1';

/** The demo's own English text and its translation; a language loads when the demo first needs it. */
type DemoDictionary = Record<string, string>;
const dictionaryLoaders: Record<Exclude<Locale, 'en'>, () => Promise<{ default: DemoDictionary }>> = {
  de: () => import('../../shared/demo-locales/de.json'),
  fr: () => import('../../shared/demo-locales/fr.json'),
  it: () => import('../../shared/demo-locales/it.json'),
  es: () => import('../../shared/demo-locales/es.json'),
  pt: () => import('../../shared/demo-locales/pt.json'),
  pl: () => import('../../shared/demo-locales/pl.json'),
};
const dictionaries = new Map<Locale, DemoDictionary>([['en', {}]]);

async function demoDictionary(locale: Locale): Promise<DemoDictionary> {
  const loaded = dictionaries.get(locale);
  if (loaded) return loaded;
  const dictionary = (await dictionaryLoaders[locale as Exclude<Locale, 'en'>]()).default;
  dictionaries.set(locale, dictionary);
  return dictionary;
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function defaultStorage(): Storage {
  if (typeof window !== 'undefined') {
    try {
      const storage = window.localStorage;
      const probeKey = 'sdt.storage.probe';
      const previous = storage.getItem(probeKey);
      storage.setItem(probeKey, '1');
      if (previous === null) storage.removeItem(probeKey);
      else storage.setItem(probeKey, previous);
      return storage;
    } catch {
      // Some privacy modes expose localStorage but deny access to it.
    }
  }
  return createMemoryStorage();
}

/** What the simulated carrier says at each stage, and where the server would place it. */
export const SIMULATED_UPDATES: Record<Stage, { description: string; location?: string; place?: EventPlace }> = {
  pending: {
    description: 'Tracking added; the carrier has not announced it yet',
  },
  registered: {
    description: 'The sender announced the parcel',
  },
  accepted: {
    description: 'Parcel accepted at the counter',
    location: 'Zürich-Mülligen',
    place: { latitude: 47.367, longitude: 8.55, precision: 'city', country: 'CH', name: 'Zürich' },
  },
  in_transit: {
    description: 'Sorted at the parcel center',
    location: 'Härkingen',
    place: { latitude: 47.305, longitude: 7.821, precision: 'city', country: 'CH', name: 'Härkingen' },
  },
  customs: {
    description: 'Held for customs clearance',
    location: 'Basel',
    place: { latitude: 47.558, longitude: 7.573, precision: 'city', country: 'CH', name: 'Basel' },
  },
  exception: {
    description: 'A problem is holding up the parcel',
    location: 'Härkingen',
    place: { latitude: 47.305, longitude: 7.821, precision: 'city', country: 'CH', name: 'Härkingen' },
  },
  out_for_delivery: {
    description: 'With the courier for delivery today',
    location: 'Your neighbourhood',
  },
  failed_attempt: {
    description: 'Nobody home — a notice was left',
  },
  ready_for_pickup: {
    description: 'Ready for pickup at your branch',
    location: 'Post branch',
  },
  delivered: {
    description: 'Delivered to your mailbox',
    location: 'Home',
  },
  returned: {
    description: 'Returned to the sender',
  },
};

/** Where the simulation goes next from a given stage. */
export function nextStage(stage: Stage): Stage | null {
  switch (stage) {
    case 'pending':
      return 'registered';
    case 'registered':
      return 'accepted';
    case 'accepted':
      return 'in_transit';
    case 'customs':
    case 'exception':
      return 'in_transit';
    case 'in_transit':
      return 'out_for_delivery';
    case 'out_for_delivery':
      return 'delivered';
    case 'failed_attempt':
      return 'ready_for_pickup';
    case 'ready_for_pickup':
      return 'delivered';
    case 'delivered':
    case 'returned':
      return null;
  }
}

function simulatedEvent(
  parcelId: string,
  stage: Stage,
  occurredAt: string,
): TrackingEvent {
  const sim = SIMULATED_UPDATES[stage];
  return {
    id: uid(),
    parcelId,
    stage,
    description: sim.description,
    location: sim.location,
    place: sim.place,
    occurredAt,
  };
}

/** Shared with the iPhone demo; dates are relative to the moment it is seeded. */
export function seedParcels(now: number): ParcelWithEvents[] {
  const iso = (hoursAgo: number) => new Date(now - hoursAgo * HOUR).toISOString();
  return demoCatalog.map((sample) => {
    const id = uid();
    let expectedDelivery: string | undefined;
    if (sample.expectedInDays !== undefined) {
      const date = new Date(now);
      date.setDate(date.getDate() + sample.expectedInDays);
      expectedDelivery = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    return {
      id, label: sample.label, trackingNumber: sample.trackingNumber,
      carrier: sample.carrier as ParcelWithEvents['carrier'],
      createdAt: iso(Math.max(...sample.events.map((event) => event.hoursAgo))),
      expectedDelivery, syncStatus: 'ok',
      archivedAt: sample.archivedHoursAgo === undefined ? undefined : iso(sample.archivedHoursAgo),
      dpdPostcode: sample.carrier === 'dpd' ? '8000' : undefined,
      senderName: sample.senderName, pickupPoint: sample.pickupPoint, weightKg: sample.weightKg,
      events: sample.events.map((event) => ({
        id: uid(), parcelId: id, stage: event.stage as Stage,
        description: event.description, location: event.location, occurredAt: iso(event.hoursAgo),
        place: event.place as EventPlace | undefined,
      })),
    };
  });
}

function load(storage: Storage): ParcelWithEvents[] | null {
  try {
    const raw = storage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? withDemoPlaces(parsed as ParcelWithEvents[]) : null;
  } catch {
    return null;
  }
}

/** Demo parcels saved before scans had places get them from the same sample data. */
function withDemoPlaces(parcels: ParcelWithEvents[]): ParcelWithEvents[] {
  const known = new Map<string, EventPlace>();
  for (const event of [...demoCatalog.flatMap((sample) => sample.events), ...Object.values(SIMULATED_UPDATES)]) {
    if (event.location && event.place) known.set(event.location, event.place as EventPlace);
  }
  return parcels.map((parcel) => parcel.events.every((event) => event.place || !event.location) ? parcel : {
    ...parcel,
    events: parcel.events.map((event) => event.place || !event.location ? event : { ...event, place: known.get(event.location) }),
  });
}

function save(storage: Storage, parcels: ParcelWithEvents[]): void {
  storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(parcels));
}

/**
 * A local, offline backend used when Supabase is not configured.
 * Parcels live in localStorage and "refresh" advances a small simulation,
 * so the app is fully usable (and demoable) with zero setup.
 */
export function createDemoRepo(
  storage: Storage = defaultStorage(),
  now: () => number = Date.now,
): ParcelRepo {
  let language: Locale = 'en';

  function saved(): ParcelWithEvents[] {
    let parcels = load(storage);
    if (!parcels) {
      parcels = seedParcels(now());
      save(storage, parcels);
      storage.setItem(CATALOG_KEY, '1');
      storage.removeItem(LANGUAGE_KEY);
    } else if (!storage.getItem(CATALOG_KEY)) {
      // Upgrade existing demos once, preserving edits, archives, and custom parcels.
      // Empty lists and separately seeded test/showcase data stay as they are.
      const legacyNumbers = ['993412345678901234', '1234567899', 'LX123456789DE'];
      if (parcels.some((parcel) => legacyNumbers.includes(parcel.trackingNumber))) {
        const existing = new Set(parcels.map((parcel) => parcel.trackingNumber));
        parcels = [...parcels, ...seedParcels(now()).filter((parcel) => !legacyNumbers.includes(parcel.trackingNumber) && !existing.has(parcel.trackingNumber))];
        save(storage, parcels);
      }
      storage.setItem(CATALOG_KEY, '1');
    }
    return parcels;
  }

  /**
   * The saved parcels with the demo's own text in the app's language. Names
   * someone edited and text the demo did not write match nothing and stay.
   */
  async function getAll(): Promise<ParcelWithEvents[]> {
    const target = language;
    const wanted = await demoDictionary(target);
    const written = storage.getItem(LANGUAGE_KEY);
    const from = isLocale(written) ? written : 'en';
    if (from === target) return saved();
    const english = new Map(Object.entries(await demoDictionary(from)).map(([text, translated]) => [translated, text]));
    const say = (text: string) => {
      const original = english.get(text) ?? text;
      return wanted[original] ?? original;
    };
    const parcels = saved().map((parcel) => ({
      ...parcel,
      label: say(parcel.label),
      events: parcel.events.map((scan) => ({
        ...scan, description: say(scan.description), location: scan.location && say(scan.location),
      })),
    }));
    save(storage, parcels);
    storage.setItem(LANGUAGE_KEY, target);
    return parcels;
  }

  /** A simulated scan, said in the language the demo is written in. */
  const event = (parcelId: string, stage: Stage, occurredAt: string): TrackingEvent => {
    const scan = simulatedEvent(parcelId, stage, occurredAt);
    const dictionary = dictionaries.get(language) ?? {};
    return {
      ...scan,
      description: dictionary[scan.description] ?? scan.description,
      location: scan.location && (dictionary[scan.location] ?? scan.location),
    };
  };

  const sortNewestFirst = (parcels: ParcelWithEvents[]) =>
    [...parcels].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const advance = (parcel: ParcelWithEvents): ParcelWithEvents => {
    if (parcel.archivedAt) return parcel;
    const stage = currentStage(parcel.events);
    if (stage === null || isFinal(stage)) return parcel;
    const next = nextStage(stage);
    if (!next) return parcel;
    // Keep timestamps strictly increasing so the newest event always wins,
    // even when refreshing several times in the same instant.
    const lastTs = Date.parse(latestEvent(parcel.events)!.occurredAt);
    const occurredAt = new Date(Math.max(now(), lastTs + 1000)).toISOString();
    const swissPostReady = supportsSwissPostHandoff(parcel.trackingNumber)
      && ['in_transit', 'customs', 'out_for_delivery', 'delivered'].includes(next);
    return {
      ...parcel,
      trackingSource: swissPostReady ? 'swiss-post' : parcel.trackingSource,
      swissPostReady: swissPostReady || parcel.swissPostReady,
      events: [...parcel.events, event(parcel.id, next, occurredAt)],
    };
  };

  return {
    mode: 'demo',

    async list() {
      return sortNewestFirst(await getAll());
    },

    setLanguage(locale: Locale) {
      language = locale;
    },

    async resetDemo() {
      save(storage, seedParcels(now()));
      storage.setItem(CATALOG_KEY, '1');
      storage.removeItem(LANGUAGE_KEY);
      return sortNewestFirst(await getAll());
    },

    async add(input: NewParcelInput) {
      const parcels = await getAll();
      const trackingNumber = normalizeTrackingNumber(input.trackingNumber);
      const existing = parcels.find((candidate) => candidate.trackingNumber === trackingNumber);
      if (existing) {
        throw new ParcelAlreadyExistsError(
          'This tracking number is already in your delivery box',
          existing.id,
        );
      }
      const createdAt = new Date(now()).toISOString();
      const parcel: ParcelWithEvents = {
        id: uid(),
        trackingNumber,
        label: input.label,
        carrier: input.carrier ?? detectCarrier(trackingNumber),
        trackingUrl: input.trackingUrl?.trim() || undefined,
        dpdPostcode: input.dpdPostcode?.trim() || undefined,
        createdAt,
        syncStatus: 'ok',
        events: [],
      };
      if (supportsSwissPostHandoff(trackingNumber)) {
        parcel.trackingSource = 'aliexpress';
        parcel.swissPostReady = false;
      }
      parcel.events = [event(parcel.id, 'pending', createdAt)];
      save(storage, [...parcels, parcel]);
      return parcel;
    },

    async rename(id: string, nextLabel: string) {
      const label = nextLabel.trim();
      if (label.length > 80) {
        throw new Error('Parcel names can be at most 80 characters');
      }
      const parcels = await getAll();
      const parcel = parcels.find((candidate) => candidate.id === id);
      if (!parcel) throw new Error('Parcel not found');
      const renamed = { ...parcel, label };
      save(
        storage,
        parcels.map((candidate) => candidate.id === id ? renamed : candidate),
      );
      return renamed;
    },

    async changeCarrier(id: string, input: ParcelCarrierInput) {
      const parcels = await getAll();
      const parcel = parcels.find((candidate) => candidate.id === id);
      if (!parcel) throw new Error('Parcel not found');
      const changedAt = new Date(now()).toISOString();
      const updated: ParcelWithEvents = {
        id: parcel.id,
        trackingNumber: parcel.trackingNumber,
        label: parcel.label,
        carrier: input.carrier,
        createdAt: parcel.createdAt,
        trackingUrl: input.trackingUrl?.trim() || undefined,
        dpdPostcode: input.dpdPostcode?.trim() || undefined,
        archivedAt: parcel.archivedAt,
        notificationsMuted: parcel.notificationsMuted,
        syncStatus: 'pending',
        events: [event(parcel.id, 'pending', changedAt)],
      };
      if (supportsSwissPostHandoff(parcel.trackingNumber)) {
        updated.trackingSource = 'aliexpress';
        updated.swissPostReady = false;
      }
      save(
        storage,
        parcels.map((candidate) => candidate.id === id ? updated : candidate),
      );
      return updated;
    },

    async setNotificationsMuted(id: string, muted: boolean) {
      const parcels = await getAll();
      const parcel = parcels.find((candidate) => candidate.id === id);
      if (!parcel) throw new Error('Parcel not found');
      const updated = { ...parcel, notificationsMuted: muted };
      save(
        storage,
        parcels.map((candidate) => candidate.id === id ? updated : candidate),
      );
      return updated;
    },

    async remove(id: string) {
      const archivedAt = new Date(now()).toISOString();
      save(
        storage,
        (await getAll()).map((parcel) => parcel.id === id ? { ...parcel, archivedAt } : parcel),
      );
    },

    async restore(id: string) {
      const parcels = await getAll();
      const parcel = parcels.find((candidate) => candidate.id === id);
      if (!parcel) throw new Error('Parcel not found');
      const restored = { ...parcel };
      delete restored.archivedAt;
      save(
        storage,
        parcels.map((candidate) => candidate.id === id ? restored : candidate),
      );
      return restored;
    },

    async deletePermanently(id: string) {
      const parcels = await getAll();
      const parcel = parcels.find((candidate) => candidate.id === id);
      if (!parcel) throw new Error('Parcel not found');
      save(storage, parcels.filter((candidate) => candidate.id !== id));
    },

    async refresh() {
      const advanced = (await getAll()).map(advance);
      save(storage, advanced);
      return sortNewestFirst(advanced);
    },

    async refreshParcel(id: string) {
      const parcels = await getAll();
      const parcel = parcels.find((candidate) => candidate.id === id);
      if (!parcel) throw new Error('Parcel not found');
      const advanced = advance(parcel);
      save(
        storage,
        parcels.map((candidate) => candidate.id === id ? advanced : candidate),
      );
      return advanced;
    },
  };
}
