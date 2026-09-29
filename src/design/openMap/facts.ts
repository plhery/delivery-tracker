import type { Place, Route, Scan, Stop } from '../../components/map/route';
import type { Snapshot } from '../map/parts';

/** One place on the itinerary: when the parcel got there, and when it last showed up there. */
export interface ItineraryStop {
  stop: Stop;
  arrived: Date;
  lastSeen: Date;
  /** The newest scan at this place: what happened there. */
  latest: Scan;
  current: boolean;
}

/** The hop to the next place, and how long it took. */
export interface ItineraryLeg {
  from: Stop;
  to: Stop;
  km: number;
  /** From the last scan at one place to the first at the next. */
  ms: number;
  approximate: boolean;
}

export type ItineraryRow = { kind: 'stop'; item: ItineraryStop } | { kind: 'leg'; item: ItineraryLeg } | { kind: 'ahead'; place: Place; km?: number };

export function itinerary(parcel: Snapshot): ItineraryRow[] {
  const { route } = parcel;
  const rows: ItineraryRow[] = [];
  route.stops.forEach((stop, index) => {
    const previous = route.stops[index - 1];
    if (previous) {
      const leg = route.legs[index - 1];
      rows.push({
        kind: 'leg',
        item: {
          from: previous, to: stop, km: leg.km, approximate: previous.place.precision === 'country' || stop.place.precision === 'country',
          ms: new Date(stop.scans[0].at).getTime() - new Date(previous.scans.at(-1)!.at).getTime(),
        },
      });
    }
    rows.push({
      kind: 'stop',
      item: {
        stop, arrived: new Date(stop.scans[0].at), lastSeen: new Date(stop.scans.at(-1)!.at), latest: stop.scans.at(-1)!,
        current: index === route.stops.length - 1,
      },
    });
  });
  if (route.destination) rows.push({ kind: 'ahead', place: route.destination, km: route.remainingKm });
  return rows;
}

/** "6 d 2 h", "16 h", "45 min": time on the road, the way a traveller says it. */
export function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60e3));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

/** A three-letter mark for a place, as a departure board would print it: "KYO", "ZUR", "HKG", "NYK". */
export function code(name: string): string {
  const words = name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  // Two words give their initials and the last letter, the way airlines shorten them.
  if (words.length > 1) return words[0][0] + words[1][0] + words.at(-1)!.at(-1)!;
  return (words[0] ?? '').slice(0, 3);
}

export interface Facts {
  km: number;
  onTheWay: number;
  countries: string[];
  places: number;
  longest?: ItineraryLeg;
  customs?: { ms: number; place?: Place };
  finished: boolean;
}

export function facts(parcel: Snapshot): Facts {
  const legs = itinerary(parcel).flatMap((row) => row.kind === 'leg' ? [row.item] : []);
  const first = new Date(parcel.scans[0].at).getTime();
  const finished = parcel.latest.stage === 'delivered' || parcel.latest.stage === 'returned';
  const end = finished ? new Date(parcel.latest.at).getTime() : parcel.now.getTime();
  // Time held for customs: from the first customs scan to the scan after the last one.
  let customs: Facts['customs'];
  const held = parcel.scans.findIndex((scan) => scan.stage === 'customs');
  if (held >= 0) {
    let release = held;
    while (parcel.scans[release + 1]?.stage === 'customs') release += 1;
    const next = parcel.scans[release + 1];
    customs = { ms: (next ? new Date(next.at).getTime() : end) - new Date(parcel.scans[held].at).getTime(), place: parcel.scans[held].place };
  }
  return {
    km: parcel.route.km,
    onTheWay: end - first,
    countries: parcel.route.countries,
    places: parcel.route.stops.length,
    longest: legs.reduce<ItineraryLeg | undefined>((best, leg) => !best || leg.km > best.km ? leg : best, undefined),
    customs,
    finished,
  };
}

/**
 * The route as it stood at `at`: every scan until then, and the hop under way drawn part of
 * the way, in proportion to the time since the parcel was last seen.
 */
export function routeAt(parcel: Snapshot, at: number, build: (scans: Scan[], destination?: Place) => Route): Route {
  const done = parcel.scans.filter((scan) => new Date(scan.at).getTime() <= at);
  const last = [...done].reverse().find((scan) => scan.place);
  const next = parcel.scans.find((scan) => new Date(scan.at).getTime() > at && scan.place);
  const scans = [...done];
  if (last?.place && next?.place && next.place.id !== last.place.id) {
    const from = new Date(last.at).getTime();
    const fraction = Math.max(0, Math.min(1, (at - from) / (new Date(next.at).getTime() - from)));
    if (fraction > 0) {
      // Along the great circle, like the hop itself is drawn.
      const tip = interpolate(last.place.coordinate, next.place.coordinate, fraction);
      scans.push({
        at: new Date(at).toISOString(), description: '', stage: 'in_transit',
        // Unnamed and outside any country: the moving tip of the line, not a place.
        place: { id: 'tip', name: '', country: 'ZZ', coordinate: tip, precision: 'city' },
      });
    }
  }
  return build(scans, parcel.journey.destination);
}

function interpolate(a: [number, number], b: [number, number], t: number): [number, number] {
  const radians = Math.PI / 180;
  const toVector = ([longitude, latitude]: [number, number]) => [
    Math.cos(latitude * radians) * Math.cos(longitude * radians),
    Math.cos(latitude * radians) * Math.sin(longitude * radians),
    Math.sin(latitude * radians),
  ];
  const [ax, ay, az] = toVector(a);
  const [bx, by, bz] = toVector(b);
  const angle = Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz)));
  if (angle < 1e-9) return a;
  const p = Math.sin((1 - t) * angle) / Math.sin(angle);
  const q = Math.sin(t * angle) / Math.sin(angle);
  const [x, y, z] = [ax * p + bx * q, ay * p + by * q, az * p + bz * q];
  return [Math.atan2(y, x) / radians, Math.asin(Math.max(-1, Math.min(1, z))) / radians];
}

