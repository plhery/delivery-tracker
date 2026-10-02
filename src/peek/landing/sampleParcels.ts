import type { MessageKey, Translate } from '../../i18n';
import type { CarrierId, EventPlace, ParcelWithEvents, Stage } from '../../types';

const HOUR = 3_600_000;

type SampleScan = readonly [stage: Stage, hoursAgo: number, place?: EventPlace];
const city = (name: string, country: string, latitude: number, longitude: number): EventPlace => ({ name, country, latitude, longitude, precision: 'city' });

/** Three fictional parcels on their way: the list someone who signs in would have. The first leads it, on its map. */
const SAMPLES: readonly { id: string; name: MessageKey; carrier: CarrierId; number: string; expectedInDays?: number; scans: readonly SampleScan[] }[] = [
  {
    id: 'vinyl', name: 'landing.parcel.vinyl', carrier: 'ups', number: '1ZDEMO202600000001', expectedInDays: 2,
    scans: [['registered', 96], ['accepted', 80, city('Shenzhen', 'CN', 22.543, 114.058)], ['in_transit', 5, city('Cologne', 'DE', 50.938, 6.96)]],
  },
  {
    id: 'lamp', name: 'landing.parcel.lamp', carrier: 'gls-de', number: 'DEMOGLS20260001', expectedInDays: 1,
    scans: [['registered', 54], ['accepted', 40, city('Berlin', 'DE', 52.52, 13.405)], ['in_transit', 6, city('Neuenstein', 'DE', 50.916, 9.577)]],
  },
  {
    id: 'gift', name: 'landing.parcel.gift', carrier: 'swiss-post', number: 'DEMOGIFT20260001',
    scans: [['registered', 50], ['accepted', 44, city('Lyon', 'FR', 45.764, 4.836)], ['customs', 12, city('Basel', 'CH', 47.558, 7.573)]],
  },
];

/** The sample parcels as the app's own cards take them, timed from `now`. */
export function sampleParcels(now: number, t: Translate): ParcelWithEvents[] {
  const iso = (hoursAgo: number) => new Date(now - hoursAgo * HOUR).toISOString();
  return SAMPLES.map(({ id, name, carrier, number, expectedInDays, scans }) => {
    let expectedDelivery: string | undefined;
    if (expectedInDays !== undefined) {
      const day = new Date(now);
      day.setDate(day.getDate() + expectedInDays);
      expectedDelivery = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    }
    return {
      id: `landing-${id}`, label: t(name), trackingNumber: number, carrier, expectedDelivery, syncStatus: 'ok',
      createdAt: iso(Math.max(...scans.map(([, hoursAgo]) => hoursAgo))), lastSyncedAt: iso(0),
      events: scans.map(([stage, hoursAgo, place], index) => ({
        id: `landing-${id}-${index}`, parcelId: `landing-${id}`, stage, description: '', occurredAt: iso(hoursAgo),
        ...(place ? { location: place.name, place } : {}),
      })),
    };
  });
}
