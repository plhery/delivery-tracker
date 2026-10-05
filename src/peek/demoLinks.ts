import { carrierBrandFamily } from '../brand';
import { normalizeTrackingNumber, parseTrackingInput, validTrackingNumber } from '../lib/carriers';
import { currentEvent, isFinal, latestEvent } from '../lib/stages';
import { uid } from '../lib/uid';
import { browserStorage } from '../store/apiRepo';
import { nextStage, seedParcels, SIMULATED_UPDATES } from '../store/demoRepo';
import type { CarrierId, ParcelWithEvents, TrackingEvent } from '../types';
import {
  GIFT_ORIGIN_DESCRIPTION,
  isParcelLinkId,
  numberEnds,
  PARCEL_LINK_ID_ALPHABET,
  ParcelLinkError,
  type ParcelAlertPreset,
  type ParcelLinksClient,
  type ParcelLinkView,
  type ParcelShare,
  type ParcelShareClient,
} from './linkModel';

export const DEMO_LINKS_STORAGE_KEY = 'sdt.peek.demo.v1'; // gitleaks:allow -- public localStorage name
/** The story of a number whose carrier has none of its own. */
const DEFAULT_STORY = 'DEMOGLS20260001';
/** A lookup answers before its first check, as the server's does; the first read after this shows the story. */
const FIRST_CHECK_MS = 1_500;
const DAY = 86_400_000;
/** As on the server: ten alerts for viewers and ten for the owner. */
const MAX_ALERTS = 10;

interface DemoLink {
  /** The owner key of a lookup; null for a link shared from the demo deliveries, which has only viewers. */
  key: string | null;
  createdAt: string;
  openedAt: string;
  /** What the link shows now. */
  parcel: ParcelWithEvents;
  /** The story the first check brings, and when. */
  arriving?: { at: number; parcel: ParcelWithEvents };
  /** Viewers read the whole number. */
  showNumber?: boolean;
  /** The sender, the contents and where it comes from stay hidden from viewers until it is delivered. */
  gift?: boolean;
  giftWords?: ParcelLinkView['link']['giftWords'];
  /** Sharing was stopped: viewers see nothing, a lookup's owner still does. */
  stopped?: boolean;
  /** The parcel of the demo deliveries this link shares. */
  account?: string;
  /** The browsers that asked for alerts. The demo sends none: it only remembers them. */
  alerts?: { endpoint: string; preset: ParcelAlertPreset; owner: boolean }[];
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
 * A gift's journey as its viewer reads it until it is delivered, by the
 * server's rule: scans from before the carrier had the parcel are left out;
 * on a journey that leaves the country of its first located scan, every scan
 * made there (and every unlocated one before the parcel is seen elsewhere)
 * keeps only its time and stage; on a journey within one country only the
 * `accepted` scans do.
 */
export function wrappedGiftEvents(events: readonly TrackingEvent[], destinationCountry: string | null): TrackingEvent[] {
  const journey = [...events].sort((a, b) => (Date.parse(a.occurredAt) || 0) - (Date.parse(b.occurredAt) || 0));
  const origin = journey.find((event) => event.place)?.place?.country ?? null;
  const abroad = origin === null ? -1 : journey.findIndex((event) => event.place && event.place.country !== origin);
  const leavesOrigin = origin !== null && (abroad !== -1 || (destinationCountry !== null && destinationCountry !== origin));
  const blurred = (event: TrackingEvent): boolean => {
    if (!leavesOrigin) return event.stage === 'accepted';
    if (event.place) return event.place.country === origin;
    return abroad === -1 || journey.indexOf(event) < abroad;
  };
  return events
    .filter((event) => event.stage !== 'pending' && event.stage !== 'registered')
    .map((event) => blurred(event)
      ? { id: event.id, parcelId: event.parcelId, stage: event.stage, occurredAt: event.occurredAt, description: GIFT_ORIGIN_DESCRIPTION, location: origin ?? undefined }
      : event);
}

/** A gift on its way, as its viewer sees the parcel: who carries it and when it arrives, and nothing about what it is. */
function wrappedGift(parcel: ParcelWithEvents): ParcelWithEvents {
  return {
    id: parcel.id, trackingNumber: '', label: '', carrier: parcel.carrier, createdAt: parcel.createdAt,
    expectedDelivery: parcel.expectedDelivery, expectedDeliveryFrom: parcel.expectedDeliveryFrom,
    lastSyncedAt: parcel.lastSyncedAt, syncStatus: parcel.syncStatus, syncError: parcel.syncError,
    trackingSource: parcel.trackingSource, originalCarrier: parcel.originalCarrier, destinationCountry: parcel.destinationCountry,
    events: wrappedGiftEvents(parcel.events, parcel.destinationCountry?.toUpperCase() ?? null),
  };
}

/**
 * Parcel links of a build without an API: fictional parcels told from the
 * demo's stories, kept in this browser. Nothing leaves the device. A link
 * read without its owner key shows what a viewer would see.
 */
export function createDemoLinks(
  storage: Storage | null = browserStorage(),
  now: () => number = Date.now,
): ParcelLinksClient & { accountShare: ParcelShareClient } {
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
    const wrapped = !!link.gift && !owner && currentEvent(link.parcel.events)?.stage !== 'delivered';
    const numberShown = owner || (!!link.showNumber && !wrapped);
    return {
      link: {
        id, role: owner ? 'owner' : 'viewer', kind: link.account ? 'shared' : 'lookup', createdAt: link.createdAt,
        forgetAt: link.account ? null : forgetAt(link), numberShown, canKeep: numberShown,
        ...(owner ? { showNumber: !!link.showNumber } : {}),
        gift: !!link.gift, shared: !link.stopped,
        ...((owner || (link.gift && !wrapped)) && link.giftWords ? { giftWords: link.giftWords } : {}),
        // The demo has no push service: a browser's alert is only remembered here.
        alerts: { available: true, vapidPublicKey: null },
      },
      parcel: wrapped ? wrappedGift(link.parcel) : numberShown ? link.parcel : { ...link.parcel, trackingNumber: '' },
      numberHint: numberShown ? null : numberEnds(trackingNumber),
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

  /** The link with the given id, when it exists and has not expired. */
  function found(links: DemoLinks, id: string): DemoLink | null {
    return isParcelLinkId(id) && Object.hasOwn(links, id) ? links[id] : null;
  }

  const shared = (links: DemoLinks, packageId: string) =>
    Object.entries(links).find(([, link]) => link.account === packageId && !link.stopped) ?? null;
  const share = (id: string, link: DemoLink): ParcelShare =>
    ({ id, showNumber: !!link.showNumber, gift: !!link.gift, createdAt: link.createdAt, ...(link.giftWords ? { giftWords: link.giftWords } : {}) });

  return {
    mode: 'demo',

    async detectCarrierPublic(trackingNumber, signal) {
      signal?.throwIfAborted();
      return { trackingNumber: normalizeTrackingNumber(trackingNumber), carrier: parseTrackingInput(trackingNumber).carrier };
    },

    async lookupParcel(input, signal) {
      signal?.throwIfAborted();
      const trackingNumber = normalizeTrackingNumber(input.trackingNumber);
      if (!/^(?:[A-Z0-9]{4,40}|\d{4}\/\d{8})$/.test(trackingNumber) || !validTrackingNumber(input.trackingNumber)) {
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
      return { id, key: link.key!, view: view(id, link, true) };
    },

    async readParcelLink(id, { key, signal, advance = false, tellStopped = false } = {}) {
      signal?.throwIfAborted();
      const links = load();
      let link = found(links, id);
      if (!link) return 'unavailable';
      const time = now();
      if (!link.account && time > Date.parse(forgetAt(link))) {
        const { [id]: forgotten, ...kept } = links;
        void forgotten;
        save(kept);
        return 'unavailable';
      }
      const owner = link.key !== null && key === link.key;
      if (link.stopped && !owner) {
        if (tellStopped) throw new ParcelLinkError('stopped');
        return 'unavailable';
      }
      const before = link;
      if (link.arriving && (advance || time >= link.arriving.at)) link = { ...link, parcel: link.arriving.parcel, arriving: undefined };
      else if (advance) link = { ...link, parcel: advanced(link.parcel) };
      // Like the server, an open link moves its last-opened time at most every five minutes.
      if (time - Date.parse(link.openedAt) > 5 * 60_000) link = { ...link, openedAt: new Date(time).toISOString() };
      // Alerts stop when the parcel is delivered.
      if (link.alerts?.length && isFinal(currentEvent(link.parcel.events)?.stage ?? 'pending')) link = { ...link, alerts: [] };
      if (link !== before) save({ ...links, [id]: link });
      return view(id, link, owner);
    },

    async forgetParcelLink(id, key) {
      const { [id]: link, ...kept } = load();
      if (!link || link.key === null || link.key !== key) throw new ParcelLinkError('unavailable');
      save(kept);
    },

    async updateParcelLink(id, key, changes, signal) {
      signal?.throwIfAborted();
      const links = load();
      const link = found(links, id);
      // Like the server: an unknown link, a wrong key and a link from an account are told apart by nobody.
      if (!link || link.key === null || link.key !== key) throw new ParcelLinkError('unavailable');
      const next: DemoLink = {
        ...link,
        ...(typeof changes.showNumber === 'boolean' ? { showNumber: changes.showNumber } : {}),
        ...(typeof changes.gift === 'boolean' ? { gift: changes.gift } : {}),
        ...(changes.giftWords ? { giftWords: changes.giftWords } : {}),
        ...(typeof changes.shared === 'boolean' ? { stopped: !changes.shared } : {}),
      };
      // Stopping takes the viewers' alerts with it; the owner's stay.
      if (next.stopped) next.alerts = next.alerts?.filter((alert) => alert.owner);
      save({ ...links, [id]: next });
      return view(id, next, true);
    },

    async setParcelAlert(id, alert, key) {
      const links = load();
      const link = found(links, id);
      if (!link) throw new ParcelLinkError('unavailable');
      const owner = link.key !== null && key === link.key;
      if (link.stopped && !owner) throw new ParcelLinkError('stopped');
      // An alert on a parcel that has arrived has nothing left to announce.
      if (isFinal(currentEvent(link.parcel.events)?.stage ?? 'pending')) return;
      const others = (link.alerts ?? []).filter((entry) => entry.endpoint !== alert.subscription.endpoint);
      if (others.filter((entry) => entry.owner === owner).length >= MAX_ALERTS) throw new ParcelLinkError('full');
      save({ ...links, [id]: { ...link, alerts: [...others, { endpoint: alert.subscription.endpoint, preset: alert.preset, owner }] } });
    },

    async removeParcelAlert(id, endpoint) {
      const links = load();
      const link = found(links, id);
      if (!link?.alerts?.some((alert) => alert.endpoint === endpoint)) return;
      save({ ...links, [id]: { ...link, alerts: link.alerts.filter((alert) => alert.endpoint !== endpoint) } });
    },

    accountShare: {
      async current(parcelId) {
        const live = shared(load(), parcelId);
        return live ? share(...live) : null;
      },

      async share(parcel, changes = {}) {
        const links = load();
        const live = shared(links, parcel.id);
        const createdAt = new Date(now()).toISOString();
        const id = live?.[0] ?? newLinkId();
        const link: DemoLink = {
          ...(live?.[1] ?? { key: null, createdAt, openedAt: createdAt, account: parcel.id }),
          // The link shows the parcel as the deliveries have it now; its name stays with them.
          parcel: { ...parcel, label: '', dpdPostcode: undefined, receiverName: undefined },
          ...(typeof changes.showNumber === 'boolean' ? { showNumber: changes.showNumber } : {}),
          ...(typeof changes.gift === 'boolean' ? { gift: changes.gift } : {}),
        ...(changes.giftWords ? { giftWords: changes.giftWords } : {}),
        };
        save({ ...links, [id]: link });
        return share(id, link);
      },

      async stop(parcelId) {
        const links = load();
        const live = shared(links, parcelId);
        // The stopped link stays as a tombstone: its viewers read that it is not shared anymore.
        if (live) save({ ...links, [live[0]]: { ...live[1], stopped: true, alerts: [] } });
      },
    },
  };
}
