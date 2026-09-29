'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { carrierInfo } from '../../lib/carriers';
import { countryName } from '../../lib/trackingLocation';
import type { Coordinate } from '../../components/map/geography';
import { buildRoute, flag, formatKm, hasNearView, type MapMode, type Place } from '../../components/map/route';
import { WorldMap } from '../../components/map/WorldMap';
import { dayLabel, time, type Snapshot } from '../map/parts';
import { code, duration, facts, itinerary, routeAt } from './facts';
import styles from './study.module.css';

export type Device = 'phone' | 'desktop';
export type Theme = 'light' | 'dark';

interface DirectionProps {
  parcel: Snapshot;
  device: Device;
  theme: Theme;
}

const finished = (parcel: Snapshot) => parcel.latest.stage === 'delivered' || parcel.latest.stage === 'returned';
// A timetable's short day: "Tue", with the time beneath.
const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Europe/Zurich' });
// A board prints a town as three letters, and a country as its own code.
const mark = (place: Place) => place.precision === 'country' ? place.country : code(place.name);
const when = (date: Date, parcel: Snapshot) => `${dayLabel(date, parcel.now)}, ${time(date)}`;

/** Journey or Nearby, as today: pressing the view you are in brings a moved map back. */
function useView(parcel: Snapshot) {
  const [chosen, setChosen] = useState<MapMode | null>(null);
  const [free, setFree] = useState(false);
  const [recenter, setRecenter] = useState(0);
  const mode = chosen ?? parcel.mode;
  const change = (next: MapMode) => {
    if (next === mode) setRecenter((count) => count + 1);
    setChosen(next);
  };
  return { mode, free, setFree, recenter, change };
}

function Close({ tone }: { tone?: 'dark' }) {
  return <button type="button" className={styles.close} data-tone={tone} aria-label="Close the map"><Icon name="close" /></button>;
}

function Views({ view, tone }: { view: ReturnType<typeof useView>; tone?: 'dark' }) {
  return <div className={styles.views} role="group" aria-label="Map view" data-tone={tone}>
    <button type="button" aria-pressed={view.mode === 'journey' && !view.free} onClick={() => view.change('journey')}>
      <Icon name="globe" /><span>Journey</span>
    </button>
    <button type="button" aria-pressed={view.mode === 'now' && !view.free} onClick={() => view.change('now')}>
      <Icon name="location" /><span>Nearby</span>
    </button>
  </div>;
}

/** Where the parcel started and where it is, as the open map says it today. */
function Summary({ parcel }: { parcel: Snapshot }) {
  const { route } = parcel;
  const origin = route.origin!;
  const end = route.destination ?? route.current!.place;
  const done = finished(parcel);
  const single = route.stops.length === 1 && !route.destination;
  const endLabel = parcel.latest.stage === 'delivered' ? 'Delivered' : route.destination ? 'To' : route.latestLocated ? 'Now' : 'Last seen';
  const total = route.km + (route.remainingKm ?? 0);
  const progress = done || !route.destination ? 1 : total ? route.km / total : 0;
  return <div className={styles.summary} data-single={single || undefined}>
    {!single && <div><span>From</span><strong>{origin.place.name}</strong><small>{flag(origin.place.country)} {countryName(origin.place.country, 'en')}</small></div>}
    <div data-end><span>{endLabel}</span><strong>{end.name}</strong><small>{flag(end.country)} {countryName(end.country, 'en')}</small></div>
    {!single && <div className={styles.summaryLine} style={{ '--progress': progress } as CSSProperties} aria-hidden="true"><span /><i /></div>}
    {!single && <p className={styles.summaryFacts}>
      {route.km >= 1 && <span>{done ? formatKm(route.km) : `${formatKm(route.km)} so far`}</span>}
      {!done && route.remainingKm !== undefined && <span>{formatKm(route.remainingKm)} to go</span>}
      {route.countries.length > 1 && <span>{route.countries.length} countries</span>}
    </p>}
  </div>;
}

/** 00. What opens today. */
export function Today({ parcel, device, theme }: DirectionProps) {
  const view = useView(parcel);
  const phone = device === 'phone';
  return <div className={styles.fill}>
    <WorldMap route={parcel.route} mode={view.mode} time={parcel.now} night interactive redrawKey={theme} live={!finished(parcel)}
      insets={phone ? { top: 64, right: 0, bottom: 240, left: 0 } : { top: 24, right: 24, bottom: 24, left: 408 }}
      recenter={view.recenter} onFreeChange={view.setFree} className={styles.fill} />
    <Close />
    <div className={styles.todayBar} data-device={device}>
      <Summary parcel={parcel} />
      {hasNearView(parcel.route) && <Views view={view} />}
    </div>
  </div>;
}

/** 01. The journey stop by stop; the list is the way around the map. */
export function Itinerary({ parcel, device, theme }: DirectionProps) {
  const phone = device === 'phone';
  const [selected, setSelected] = useState<string | null>(null);
  const [recenter, setRecenter] = useState(0);
  const [free, setFree] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => itinerary(parcel), [parcel]);
  const stop = parcel.route.stops.find((item) => item.id === selected);
  const focus = useMemo<Coordinate[] | undefined>(() => stop ? [stop.place.coordinate] : undefined, [stop]);
  const sheet = expanded ? 620 : 408;
  const carrier = carrierInfo(parcel.journey.carrier);

  function select(id: string) {
    setSelected((current) => current === id ? null : id);
    setRecenter((count) => count + 1);
  }

  return <div className={styles.itinerary} data-device={device} style={{ '--sheet': `${sheet}px` } as CSSProperties}>
    <WorldMap route={parcel.route} mode={parcel.mode} time={parcel.now} night interactive redrawKey={theme} live={!finished(parcel)}
      focus={focus} selected={selected ?? undefined} recenter={recenter} onFreeChange={setFree}
      insets={phone ? { top: 64, right: 0, bottom: sheet - 20, left: 0 } : { top: 24, right: 24, bottom: 24, left: 420 }}
      className={styles.itineraryMap} />
    <Close />
    {(selected || free) && <button type="button" className={styles.wholeTrip} onClick={() => {
      setSelected(null);
      setRecenter((count) => count + 1);
    }}><Icon name="globe" />Whole trip</button>}
    <section className={styles.itinerarySheet} aria-label="Itinerary">
      {phone && <button type="button" className={styles.grabber} onClick={() => setExpanded((open) => !open)}
        aria-label={expanded ? 'Show more of the map' : 'Show more of the itinerary'} aria-expanded={expanded} />}
      <header className={styles.itineraryHead}>
        <p>{carrier.name}</p>
        <h2>{parcel.journey.label}</h2>
        <span>{parcel.status} · {parcel.arrival}</span>
      </header>
      <ol className={styles.itineraryList}>
        {rows.map((row) => {
          if (row.kind === 'leg') {
            const { item } = row;
            return <li key={`leg-${item.to.id}`} className={styles.itineraryLeg} data-approximate={item.approximate || undefined}>
              <span className={styles.rail} aria-hidden="true" />
              <span><svg aria-hidden="true" viewBox="0 0 24 12"><path d="M2 10C7 1 17 1 22 10" /></svg>
                {item.km >= 1 ? formatKm(item.km) : 'Nearby'} · {duration(item.ms)}</span>
            </li>;
          }
          if (row.kind === 'ahead') return <li key="ahead" className={styles.itineraryAhead}>
            <span className={styles.itineraryTime}><span>{weekday.format(new Date(parcel.journey.expected))}</span>Expected</span>
            <span className={styles.rail} aria-hidden="true"><i /></span>
            <span className={styles.itineraryPlace}><strong>{flag(row.place.country)} {row.place.name}</strong>
              <span>{row.km !== undefined ? `${formatKm(row.km)} to go` : 'Destination'}</span></span>
          </li>;
          const { item } = row;
          const stay = item.lastSeen.getTime() - item.arrived.getTime();
          return <li key={item.stop.id} className={styles.itineraryStop} data-current={item.current || undefined}
            data-selected={selected === item.stop.id || undefined}>
            <button type="button" aria-pressed={selected === item.stop.id} onClick={() => select(item.stop.id)}>
              <span className={styles.itineraryTime}><span>{weekday.format(item.arrived)}</span>{time(item.arrived)}</span>
              <span className={styles.rail} aria-hidden="true"><i /></span>
              <span className={styles.itineraryPlace}>
                <strong>{flag(item.stop.place.country)} {item.stop.place.name}</strong>
                <span>{item.latest.description}</span>
              </span>
              {stay >= 60 * 60e3 && <small>{duration(stay)}</small>}
            </button>
          </li>;
        })}
      </ol>
    </section>
  </div>;
}

/** 02. Scrub through time; the route draws itself as the parcel went. */
export function Replay({ parcel, device, theme }: DirectionProps) {
  const start = new Date(parcel.scans[0].at).getTime();
  const end = new Date(parcel.latest.at).getTime();
  const span = Math.max(end - start, 1);
  const [at, setAt] = useState(end);
  const [playing, setPlaying] = useState(false);
  const from = useRef(start);
  const route = useMemo(() => routeAt(parcel, at, buildRoute), [parcel, at]);
  // The whole trip stays in frame while the line draws.
  const focus = useMemo(() => [...parcel.route.stops.map((stop) => stop.place.coordinate),
    ...(parcel.route.destination ? [parcel.route.destination.coordinate] : [])], [parcel]);
  const phone = device === 'phone';
  const scan = [...parcel.scans].reverse().find((item) => new Date(item.at).getTime() <= at) ?? parcel.scans[0];
  const place = [...parcel.scans].reverse().find((item) => new Date(item.at).getTime() <= at && item.place)?.place;
  const days = dayMarks(start, end);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = 0;
    let value = from.current;
    // The whole trip plays in eight seconds, whatever its length.
    const step = (now: number) => {
      if (previous) value = Math.min(end, value + span * (now - previous) / 8000);
      previous = now;
      setAt(value);
      if (value >= end) return setPlaying(false);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, end, span]);

  function play() {
    if (playing) return setPlaying(false);
    from.current = at >= end ? start : at;
    setPlaying(true);
  }

  return <div className={styles.fill} data-device={device}>
    <WorldMap route={route} mode="journey" time={new Date(at)} night interactive redrawKey={theme} focus={focus} labels="all"
      live={playing || (at >= end && !finished(parcel))}
      insets={phone ? { top: 64, right: 0, bottom: 214, left: 0 } : { top: 24, right: 24, bottom: 180, left: 24 }}
      className={styles.fill} />
    <Close />
    <section className={styles.replayPanel} data-device={device} aria-label="Replay">
      <div className={styles.replayNow}>
        <p>{dayLabel(new Date(at), parcel.now)} · {time(new Date(at))}</p>
        <strong>{scan.description}</strong>
        <span>{place ? `${flag(place.country)} ${place.name}` : 'Place not given'}</span>
      </div>
      <div className={styles.timeline}>
        <button type="button" className={styles.play} onClick={play} aria-label={playing ? 'Pause' : 'Replay the journey'} aria-pressed={playing}>
          {playing ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10M11 3v10" /></svg>
            : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l8 5-8 5V3Z" /></svg>}
        </button>
        <div className={styles.track} style={{ '--at': (at - start) / span } as CSSProperties}>
          <span className={styles.trackFill} aria-hidden="true" />
          {parcel.scans.map((item) => <i key={item.at} data-stage={item.stage} data-past={new Date(item.at).getTime() <= at || undefined}
            style={{ left: `${(new Date(item.at).getTime() - start) / span * 100}%` }} aria-hidden="true" />)}
          <input type="range" min={start} max={end} step={60e3} value={at} aria-label="Time"
            aria-valuetext={`${dayLabel(new Date(at), parcel.now)}, ${time(new Date(at))}`}
            onChange={(event) => {
              setPlaying(false);
              setAt(Number(event.target.value));
            }} />
          <div className={styles.days} aria-hidden="true">
            {days.map((day) => <span key={day.at} style={{ left: `${(day.at - start) / span * 100}%` }}>{day.label}</span>)}
          </div>
        </div>
      </div>
    </section>
  </div>;
}

/** Midnights between two moments, for the timeline's day marks. */
function dayMarks(start: number, end: number): { at: number; label: string }[] {
  const zone = 'Europe/Zurich';
  const format = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: zone });
  const hour = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: zone });
  const marks: { at: number; label: string }[] = [];
  // Step hour by hour to the first local midnight, then a day at a time.
  let at = Math.ceil(start / 36e5) * 36e5;
  while (at <= end && Number(hour.format(at)) !== 0) at += 36e5;
  for (; at <= end; at += 864e5) marks.push({ at, label: format.format(at) });
  // Too many to read: every other one.
  return marks.length > 8 ? marks.filter((_, index) => index % 2 === 0) : marks;
}

/** 03. Flighty's departure board: big ends, then the map, then the facts. */
export function Board({ parcel, device, theme }: DirectionProps) {
  const view = useView(parcel);
  const phone = device === 'phone';
  const { route } = parcel;
  const origin = route.origin!;
  const end: Place = route.destination ?? route.current!.place;
  const single = route.stops.length === 1 && !route.destination;
  const trip = facts(parcel);
  const done = finished(parcel);
  const total = route.km + (route.remainingKm ?? 0);
  const progress = done || !route.destination ? 1 : total ? route.km / total : 0;
  const started = new Date(origin.scans[0].at);
  const endTime = done ? when(new Date(parcel.latest.at), parcel) : route.destination ? parcel.arrival : when(new Date(route.current!.scans.at(-1)!.at), parcel);
  const carrier = carrierInfo(parcel.journey.carrier);
  const map = <div className={styles.boardMap}>
    <WorldMap route={route} mode={view.mode} time={parcel.now} night interactive redrawKey={theme} live={!done} labels="ends"
      insets={phone ? { top: 16, right: 0, bottom: 16, left: 0 } : { top: 24, right: 24, bottom: 24, left: 24 }}
      recenter={view.recenter} onFreeChange={view.setFree} className={styles.fill} />
    {hasNearView(route) && <div className={styles.boardViews}><Views view={view} /></div>}
  </div>;
  return <div className={styles.board} data-device={device}>
    <div className={styles.boardPanel}>
      <header className={styles.boardHead}>
        <span>{parcel.journey.label}</span>
        <small>{carrier.name} · {parcel.status}</small>
      </header>
      <div className={styles.boardEnds} data-single={single || undefined}>
        {!single && <div>
          <strong>{mark(origin.place)}</strong>
          <span>{flag(origin.place.country)} {origin.place.name}</span>
          <small>{when(started, parcel)}</small>
        </div>}
        {!single && <div className={styles.boardTrip} style={{ '--progress': progress } as CSSProperties}>
          <span>{duration(trip.onTheWay)}</span>
          <i aria-hidden="true"><b /></i>
        </div>}
        <div data-end>
          <strong>{mark(end)}</strong>
          <span>{flag(end.country)} {end.name}</span>
          <small>{endTime}</small>
        </div>
      </div>
      {phone && map}
      <dl className={styles.boardFacts}>
        {route.km >= 1 && <div><dt>{done ? 'Distance' : 'So far'}</dt><dd>{formatKm(route.km)}</dd></div>}
        <div><dt>{done ? 'Took' : 'On the way'}</dt><dd>{duration(trip.onTheWay)}</dd></div>
        <div><dt>{trip.countries.length === 1 ? 'Country' : 'Countries'}</dt><dd className={styles.flags}>{trip.countries.map(flag).join(' ')}</dd></div>
        <div><dt>{trip.places === 1 ? 'Place' : 'Places'}</dt><dd>{trip.places}</dd></div>
        {trip.longest && trip.longest.km >= 1 && <div data-wide>
          <dt>Longest hop</dt>
          <dd>{formatKm(trip.longest.km)}<small>{trip.longest.from.place.name} to {trip.longest.to.place.name}, {duration(trip.longest.ms)}</small></dd>
        </div>}
        {trip.customs && <div data-wide>
          <dt>Customs</dt>
          <dd>{duration(trip.customs.ms)}<small>{trip.customs.place ? `in ${trip.customs.place.name}` : 'held'}{done || parcel.latest.stage !== 'customs' ? '' : ', so far'}</small></dd>
        </div>}
        {!done && route.remainingKm !== undefined && <div data-wide>
          <dt>Still to go</dt><dd>{formatKm(route.remainingKm)}<small>to {end.name}</small></dd>
        </div>}
      </dl>
    </div>
    {!phone && map}
    <Close />
  </div>;
}

/** 04. A dark globe in space, the route as light across it. */
export function Night({ parcel, device, theme }: DirectionProps) {
  const view = useView(parcel);
  const phone = device === 'phone';
  const { route } = parcel;
  const origin = route.origin!;
  const end = route.destination ?? route.current!.place;
  const single = route.stops.length === 1 && !route.destination;
  const trip = facts(parcel);
  return <div className={styles.night} data-device={device}>
    <WorldMap route={route} mode={view.mode} time={parcel.now} night interactive redrawKey={`night-${theme}`} live={!finished(parcel)}
      insets={phone ? { top: 96, right: 0, bottom: 116, left: 0 } : { top: 96, right: 40, bottom: 110, left: 40 }}
      recenter={view.recenter} onFreeChange={view.setFree} className={`${styles.fill} ${styles.nightMap}`} />
    <header className={styles.nightTitle}>
      <strong>{single ? end.name : <>{origin.place.name}<span aria-hidden="true"> → </span><span className={styles.visuallyHidden}> to </span>{end.name}</>}</strong>
      <span>{parcel.journey.label}</span>
    </header>
    <Close tone="dark" />
    <div className={styles.nightPill} data-device={device}>
      <p>
        <strong>{parcel.status}</strong>
        {route.km >= 1 && <span>{formatKm(route.km)}</span>}
        <span>{duration(trip.onTheWay)}</span>
      </p>
      {hasNearView(route) && <Views view={view} tone="dark" />}
    </div>
  </div>;
}

