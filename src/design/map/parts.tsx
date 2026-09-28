'use client';

import type { ReactNode } from 'react';
import { CarrierMark } from '../../components/CarrierMark';
import { Icon, PostageStamp } from '../../components/Icon';
import { carrierInfo } from '../../lib/carriers';
import { parcelIcon } from '../../lib/parcelDesign';
import { STAGE_META } from '../../lib/stages';
import type { Stage } from '../../types';
import type { Journey } from './journeys';
import { buildRoute, defaultMode, flag, formatKm, type MapMode, type Route, type Scan } from './route';
import styles from './study.module.css';

const ZONE = 'Europe/Zurich';
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: ZONE });
const calendar = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: ZONE });
const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: ZONE });
const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: ZONE });
const STATUS: Partial<Record<Stage, string>> = {
  registered: 'Announced', accepted: 'Picked up', in_transit: 'On the way', customs: 'With customs',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered', ready_for_pickup: 'Ready for pickup',
};

function dayNumber(date: Date) {
  const [year, month, day] = calendar.format(date).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 864e5;
}

export function dayLabel(date: Date, now: Date): string {
  const difference = dayNumber(date) - dayNumber(now);
  if (difference === 0) return 'Today';
  if (difference === 1) return 'Tomorrow';
  if (difference === -1) return 'Yesterday';
  return Math.abs(difference) < 6 ? weekday.format(date) : shortDate.format(date);
}

export const time = (date: Date) => clock.format(date);
const lower = (label: string) => ['Today', 'Tomorrow', 'Yesterday'].includes(label) ? label.toLowerCase() : label;

/** The parcel as it stood after one scan: what every direction renders. */
export interface Snapshot {
  journey: Journey;
  step: number;
  scans: Scan[];
  latest: Scan;
  route: Route;
  now: Date;
  status: string;
  arrival: string;
  mode: MapMode;
}

export function snapshot(journey: Journey, step: number): Snapshot {
  const scans = journey.scans.slice(0, step + 1);
  const latest = scans.at(-1)!;
  const at = new Date(latest.at);
  const now = new Date(at.getTime() + 40 * 60e3);
  const route = buildRoute(scans, journey.destination);
  const arrival = latest.stage === 'delivered' ? `Delivered ${lower(dayLabel(at, now))} at ${time(at)}`
    : latest.stage === 'out_for_delivery' ? 'Arriving today'
      : `Expected ${lower(dayLabel(new Date(journey.expected), now))}`;
  return {
    journey, step, scans, latest, route, now, arrival,
    status: STATUS[latest.stage] ?? STAGE_META[latest.stage].label,
    mode: defaultMode(route, latest.stage),
  };
}

export const daysOnTheWay = (parcel: Snapshot) => Math.max(1, Math.round((parcel.now.getTime() - new Date(parcel.scans[0].at).getTime()) / 864e5));

export function NavBar({ floating = false }: { floating?: boolean }) {
  return <div className={styles.navBar} data-floating={floating || undefined}>
    <span className={styles.navBack}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m13 4-6 6 6 6" /></svg>{!floating && 'Back'}</span>
    {!floating && <span className={styles.navTitle}>Parcel</span>}
    <span className={styles.navMore} aria-hidden="true">•••</span>
  </div>;
}

export function Progress({ stage }: { stage: Stage }) {
  const position = STAGE_META[stage].progress;
  return <div className={styles.progress} aria-hidden="true">
    {Array.from({ length: 6 }, (_, index) => <span key={index} data-filled={index <= position || undefined} />)}
  </div>;
}

/** The parcel's postcard, as in the app; `map` fills its top edge in the Card direction. */
export function HeroCard({ parcel, map, action, compact = false }: { parcel: Snapshot; map?: ReactNode; action?: ReactNode; compact?: boolean }) {
  const carrier = carrierInfo(parcel.journey.carrier);
  return <section className={styles.hero} data-compact={compact || undefined} data-map={map ? true : undefined}>
    {map}
    <div className={styles.heroMeta}>
      <CarrierMark carrier={carrier} />
      <span className={styles.heroActions}>
        {action}
        <svg className={styles.bell} aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      </span>
    </div>
    <div className={styles.heroTitle}>
      <h2>{parcel.journey.label}</h2>
      {!compact && <PostageStamp icon={parcelIcon(parcel.latest.stage)} />}
    </div>
    <p className={styles.heroState}>{parcel.status}</p>
    <p className={styles.heroArrival}>{parcel.arrival}</p>
    <Progress stage={parcel.latest.stage} />
  </section>;
}

/**
 * Flighty's departure board, for a parcel: where it started, where it is
 * going, and how much of the way is behind it.
 */
export function RouteSummary({ parcel }: { parcel: Snapshot }) {
  const { route, latest } = parcel;
  const origin = route.origin;
  if (!origin) return null;
  const delivered = latest.stage === 'delivered';
  const end = route.destination ?? route.current!.place;
  const endLabel = delivered ? 'Delivered' : route.destination ? 'To' : route.latestLocated ? 'Now' : 'Last seen';
  const endDetail = delivered ? `${dayLabel(new Date(latest.at), parcel.now)}, ${time(new Date(latest.at))}`
    : route.destination ? parcel.arrival : `${dayLabel(new Date(route.current!.scans.at(-1)!.at), parcel.now)}, ${time(new Date(route.current!.scans.at(-1)!.at))}`;
  const started = new Date(origin.scans[0].at);
  if (route.stops.length === 1 && !route.destination) {
    return <div className={styles.routeSummary} data-single>
      <div><span>{endLabel}</span><strong>{end.name}</strong><small>{flag(end.country)} {endDetail}</small></div>
    </div>;
  }
  const total = route.km + (route.remainingKm ?? 0);
  const progress = delivered || !route.destination ? 1 : total ? route.km / total : 0;
  return <div className={styles.routeSummary}>
    <div><span>From</span><strong>{origin.place.name}</strong><small>{flag(origin.place.country)} {dayLabel(started, parcel.now)}, {time(started)}</small></div>
    <div data-end><span>{endLabel}</span><strong>{end.name}</strong><small>{flag(end.country)} {endDetail}</small></div>
    <div className={styles.routeLine} style={{ ['--progress' as string]: progress }} aria-hidden="true"><span /><i /></div>
    <p className={styles.routeFacts}>
      {route.km >= 1 && <span>{formatKm(route.km)} so far</span>}
      {route.remainingKm !== undefined && <span>{formatKm(route.remainingKm)} to go</span>}
      {route.countries.length > 1 && <span>{route.countries.length} countries</span>}
    </p>
  </div>;
}

export function Stats({ parcel }: { parcel: Snapshot }) {
  const { route } = parcel;
  if (!route.stops.length) return null;
  const days = daysOnTheWay(parcel);
  const distance = route.km >= 1 ? formatKm(route.km).split(' ') : null;
  return <dl className={styles.stats}>
    {distance && <div><dt>km so far</dt><dd>{distance[0]}</dd></div>}
    <div><dt>{route.countries.length === 1 ? 'country' : 'countries'}</dt><dd>{route.countries.length}</dd></div>
    <div><dt>{days === 1 ? 'day' : 'days'} on the way</dt><dd>{days}</dd></div>
  </dl>;
}

/** The tracking journal, newest first, with the long hops between places spelled out. */
export function History({ parcel, legs = true }: { parcel: Snapshot; legs?: boolean }) {
  const { route } = parcel;
  // A leg is shown below the scan where the parcel arrived, the way a layover sits between flights.
  const arrivals = new Map(route.legs.filter(leg => leg.km >= 250).map(leg => [leg.to.scans[0], leg]));
  const items: ReactNode[] = [];
  let day = '';
  for (const [index, scan] of [...parcel.scans].reverse().entries()) {
    const at = new Date(scan.at);
    const label = dayLabel(at, parcel.now);
    if (label !== day) {
      day = label;
      items.push(<li key={`day-${scan.at}`} className={styles.historyDay}>{label}</li>);
    }
    items.push(<li key={scan.at} className={styles.historyScan} data-current={index === 0 || undefined}>
      <time>{time(at)}</time>
      <div><p>{scan.description}</p>{scan.place && <span className={styles.historyPlace}>
        <span className={styles.historyFlag} aria-hidden="true">{flag(scan.place.country)}</span>{scan.place.name}
      </span>}</div>
    </li>);
    const leg = legs ? arrivals.get(scan) : undefined;
    if (leg) items.push(<li key={`leg-${leg.id}`} className={styles.historyLeg}>
      <svg aria-hidden="true" viewBox="0 0 24 12"><path d="M2 10C7 1 17 1 22 10" /></svg>
      <span>{leg.from.place.name} to {leg.to.place.name}</span><strong>{formatKm(leg.km)}</strong>
    </li>);
  }
  return <section className={styles.history} aria-label="Tracking history">
    <div className={styles.historyHeading}><h3>Tracking history</h3><span>{parcel.scans.length} updates <Icon name="chevron" /></span></div>
    <ol>{items}</ol>
  </section>;
}

export function TrackingNumber() {
  return <div className={styles.trackingNumber}><span>Tracking number</span><strong>SAMPLE 0000 0000</strong></div>;
}

export function ModeToggle({ mode, onChange, free = false, compact = false }: {
  mode: MapMode; onChange: (mode: MapMode) => void; free?: boolean; compact?: boolean;
}) {
  return <div className={styles.modeToggle} role="group" aria-label="Map view" data-compact={compact || undefined}>
    <button type="button" aria-pressed={mode === 'journey' && !free} onClick={() => onChange('journey')}>
      <Icon name="globe" /><span>Journey</span>
    </button>
    <button type="button" aria-pressed={mode === 'now' && !free} onClick={() => onChange('now')}>
      <Icon name="location" /><span>Nearby</span>
    </button>
  </div>;
}
