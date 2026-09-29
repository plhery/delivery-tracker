'use client';

import Link from 'next/link';
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { carrierBrand } from '../../lib/carrierBrand';
import { carrierInfo } from '../../lib/carriers';
import type { CarrierId } from '../../types';
import { journeys, type JourneyGroup } from '../map/journeys';
import { dayLabel, snapshot, time } from '../map/parts';
import { Board, Itinerary, Night, Replay, Today, type Device, type Theme } from './directions';
import styles from './study.module.css';

type Direction = 'today' | 'itinerary' | 'replay' | 'board' | 'night';

const DIRECTIONS: readonly { id: Direction; number: string; name: string; summary: string; notes: readonly string[] }[] = [
  {
    id: 'today', number: '00', name: 'Today', summary: 'What opens now: the map, and where from and to.',
    notes: [
      'The map fills the screen. A card along the bottom, or beside the map on a desktop, says where the parcel started and where it is.',
      'It answers “where?” well and “what happened?” not at all: the stops, the waits and the hops stay in the journal behind it.',
    ],
  },
  {
    id: 'itinerary', number: '01', name: 'Itinerary', summary: 'The journey stop by stop, beside the map.',
    notes: [
      'Like a train’s timetable: every place in order, when the parcel got there, how long it stayed, and the hop to the next one.',
      'Tap a place and the map flies to it. The list is the way around the map, so Journey and Nearby give way to “Whole trip”.',
      'On a phone the list is a sheet you can pull up; on a desktop it docks beside the map.',
    ],
  },
  {
    id: 'replay', number: '02', name: 'Replay', summary: 'Scrub through time and watch it travel.',
    notes: [
      'A timeline of the whole trip, with every scan on it. Drag it, or press play, and the route draws itself as the parcel went.',
      'Between two scans the line grows in proportion to the time since the last one: a replay of the hop, not a tracked position.',
      'The camera holds the whole trip, so the story unfolds in one frame.',
    ],
  },
  {
    id: 'board', number: '03', name: 'Board', summary: 'Big numbers, like a departure board.',
    notes: [
      'Flighty’s type: the two ends in large letters, the time on the way between them, then the map, then the facts.',
      'Distance, days, countries, places, the longest hop and the wait at customs: things a journal can’t show at a glance.',
      'The most shareable screen. On a desktop the map takes the right half.',
    ],
  },
  {
    id: 'night', number: '04', name: 'Night flight', summary: 'A dark globe, the route glowing across it.',
    notes: [
      'Always dark, whatever the theme: a globe in space with a thin atmosphere, the night side where it is night, and the route as light.',
      'Almost no interface: where from and to at the top, a slim pill with the status and the view at the bottom.',
      'The most atmospheric, and the least informative. It suits long journeys best.',
    ],
  },
];

// What each direction tells without leaving the map, in the order of DIRECTIONS.
const QUESTIONS: readonly { question: string; answers: readonly string[] }[] = [
  { question: 'Where is it now?', answers: ['On the map', 'Map and list', 'At the end of the line', 'Map and board', 'On the globe'] },
  { question: 'Where has it been?', answers: ['Where it started', 'Every place, in order', 'Every place, as it went', 'Where it started', 'On the globe'] },
  { question: 'When did it get there?', answers: ['—', 'Each place', 'Each scan', 'Start and end', '—'] },
  { question: 'How long did it take?', answers: ['—', 'Each hop and stay', 'As it plays', 'In total, and the longest hop', 'In total'] },
  { question: 'How far?', answers: ['So far and to go', 'Each hop', '—', 'So far, to go, the longest hop', 'So far'] },
];

const GROUPS: readonly JourneyGroup[] = ['Far', 'Near', 'Sparse'];
// The map only opens once a scan has a place.
const OPENABLE = journeys.filter((journey) => journey.scans.some((scan) => scan.place));
const WIDE = '(min-width: 1100px)';
const subscribe = () => () => {};
function subscribeToWidth(onChange: () => void) {
  const query = matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function OpenMapStudy() {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const [direction, setDirection] = useState<Direction>('itinerary');
  const [journeyId, setJourneyId] = useState('world');
  const [steps, setSteps] = useState<Record<string, number>>({});
  const wide = useSyncExternalStore(subscribeToWidth, () => matchMedia(WIDE).matches, () => false);
  const [chosenDevice, setDevice] = useState<Device | null>(null);
  const device = chosenDevice ?? (wide ? 'desktop' : 'phone');
  const [theme, setTheme] = useState<Theme>('light');
  const journey = OPENABLE.find((item) => item.id === journeyId)!;
  const last = journey.scans.length - 1;
  // The first scan with a place is as early as the map can open.
  const first = journey.scans.findIndex((scan) => scan.place);
  const step = steps[journeyId] ?? journey.initialStep;
  const parcel = useMemo(() => snapshot(journey, step), [journey, step]);
  const active = DIRECTIONS.find((item) => item.id === direction)!;
  const View = { today: Today, itinerary: Itinerary, replay: Replay, board: Board, night: Night }[direction];
  const latestAt = new Date(parcel.latest.at);

  return <main className={styles.study} data-ready={ready} inert={!ready}>
    <header className={styles.studyHeader}>
      <Link href="/" className={styles.brand}><Icon name="parcel" /><span>Delivery Tracker</span><span className={styles.badge}>Design study</span></Link>
      <Link href="/design/map" className={styles.crossLink}>Near and far <Icon name="chevron" /></Link>
    </header>
    <section className={styles.intro}>
      <p className={styles.eyebrow}>The open map</p>
      <h1>You tapped the globe. Now what?</h1>
      <p>Four ways the full map could tell a parcel’s journey once it is open, next to what it shows today. Each works on a phone and a desktop, in light and dark.</p>
    </section>
    <div className={styles.directions} role="group" aria-label="Direction">
      {DIRECTIONS.map((item) => <button key={item.id} type="button" aria-pressed={direction === item.id} onClick={() => setDirection(item.id)}>
        <span className={styles.directionNumber}>{item.number}</span>
        <strong>{item.name}</strong>
        <span>{item.summary}</span>
      </button>)}
    </div>
    <div className={styles.bench}>
      <aside className={styles.controls}>
        <fieldset className={styles.journeys}>
          <legend>Journey</legend>
          {GROUPS.map((group) => <div key={group} className={styles.journeyGroup}>
            <span>{group}</span>
            <div>{OPENABLE.filter((item) => item.group === group).map((item) => <button key={item.id} type="button"
              aria-pressed={journeyId === item.id} onClick={() => setJourneyId(item.id)}>{item.name}</button>)}</div>
          </div>)}
        </fieldset>
        <div className={styles.scrubber}>
          <div className={styles.scrubberHead}><span>Parcel after scan {step + 1} of {last + 1}</span></div>
          <input type="range" min={first} max={last} step={1} value={step} aria-label="Parcel after scan"
            onChange={(event) => setSteps((previous) => ({ ...previous, [journeyId]: Number(event.target.value) }))} />
          <p><strong>{parcel.latest.description}</strong>
            <span>{parcel.latest.place ? parcel.latest.place.name : 'No place given'} · {dayLabel(latestAt, parcel.now)}, {time(latestAt)}</span></p>
        </div>
        <div className={styles.previewControls}>
          <div role="group" aria-label="Preview size">
            <button type="button" aria-pressed={device === 'phone'} onClick={() => setDevice('phone')}>Phone</button>
            <button type="button" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}>Desktop</button>
          </div>
          <div role="group" aria-label="Appearance">
            <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>Light</button>
            <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>Dark</button>
          </div>
        </div>
        <div className={styles.notes}>
          <p className={styles.eyebrow}>{active.number} · {active.name}</p>
          {active.notes.map((note) => <p key={note}>{note}</p>)}
        </div>
      </aside>
      <section className={styles.preview} aria-label="Map preview">
        {ready && <Frame device={device} theme={direction === 'night' ? 'dark' : theme} carrier={journey.carrier}>
          {/* A new parcel or scan starts the direction afresh, as opening the map again would. */}
          <View key={`${journeyId}:${step}`} parcel={parcel} device={device} theme={theme} />
        </Frame>}
      </section>
    </div>
    {/* On a phone the controls scroll away, so the essentials follow the preview. */}
    <div className={styles.dock} role="group" aria-label="Quick controls">
      <div role="group" aria-label="Direction">
        {DIRECTIONS.map((item) => <button key={item.id} type="button" aria-pressed={direction === item.id}
          onClick={() => setDirection(item.id)}>{item.number}</button>)}
      </div>
      <button type="button" className={styles.dockJourney} onClick={() => {
        setJourneyId(OPENABLE[(OPENABLE.indexOf(journey) + 1) % OPENABLE.length].id);
      }} aria-label={`Journey: ${journey.name}. Show the next journey`}>{journey.name}<Icon name="chevron" /></button>
    </div>
    <section className={styles.compare} aria-label="What each direction answers">
      <p className={styles.eyebrow}>What each one answers at a glance</p>
      <div className={styles.compareScroll}>
        <table>
          <thead><tr><td />{DIRECTIONS.map((item) => <th key={item.id} scope="col"><span>{item.number}</span>{item.name}</th>)}</tr></thead>
          <tbody>{QUESTIONS.map((row) => <tr key={row.question}>
            <th scope="row">{row.question}</th>
            {row.answers.map((answer, index) => <td key={DIRECTIONS[index].id} data-none={answer === '—' || undefined}>{answer}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <p className={styles.footnote}>Fictional parcels at city centres, placed the way the server places real scans. Times are in Zürich time.</p>
  </main>;
}

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

function Frame({ device, theme, carrier, children }: { device: Device; theme: Theme; carrier: CarrierId; children: ReactNode }) {
  const holder = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useLayoutEffect(() => {
    const element = holder.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const size = device === 'phone' ? PHONE : DESKTOP;
  // A phone narrower than the frame shows it edge to edge; a desktop frame scales down to fit.
  const width = device === 'phone' ? Math.min(size.width, available || size.width) : size.width;
  const scale = device === 'phone' ? 1 : Math.min(1, (available || size.width) / size.width);
  return <div ref={holder} className={styles.frameHolder} style={{ height: size.height * scale }}>
    <div className={styles.frame} data-device={device} style={{ width, height: size.height, transform: scale < 1 ? `scale(${scale})` : undefined }}>
      <div className={styles.screen} data-theme={theme} data-device={device} style={carrierBrand(carrierInfo(carrier)).style}>{children}</div>
    </div>
  </div>;
}
