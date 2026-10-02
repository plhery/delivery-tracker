'use client';

import Link from 'next/link';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { PeekMark } from '../../components/PeekMark';
import { carrierBrand } from '../../lib/carrierBrand';
import { carrierInfo } from '../../lib/carriers';
import type { CarrierId } from '../../types';
import { Card, Deck, Lens, type Device, type Theme } from './directions';
import { journeys, type JourneyGroup } from './journeys';
import { dayLabel, snapshot, time } from './parts';
import type { MapMode } from '../../components/map/route';
import { WorldMap } from '../../components/map/WorldMap';
import styles from './study.module.css';

type Direction = 'deck' | 'card' | 'lens';

const DIRECTIONS: readonly { id: Direction; number: string; name: string; summary: string; notes: readonly string[] }[] = [
  {
    id: 'deck', number: '01', name: 'Deck', summary: 'The map is the page; the parcel slides over it.',
    notes: [
      'Flighty’s own layout. On a phone the map fills the top half under floating buttons, and the parcel is a sheet you pull over it. On a desktop the map becomes the backdrop and the parcel docks beside it.',
      'Room for everything: the globe, the arcs, place and country names, and a pointer back to where the parcel started.',
      'The boldest change. It fits best if the map becomes the main reason to open a parcel.',
    ],
  },
  {
    id: 'card', number: '02', name: 'Card', summary: 'The route, engraved in the parcel’s own card.',
    notes: [
      'The quietest change. The carrier-coloured card gains a band where the route is drawn in the card’s own ink. The rest of the page stays as it is.',
      'Tap the band for the full map, with the same close-up and journey views as Deck.',
      'Small, so it shows only the ends of the journey. It could carry over to the parcel list later.',
    ],
  },
  {
    id: 'lens', number: '03', name: 'Lens', summary: 'A small globe, with the story told around it.',
    notes: [
      'A round globe between the card and the history, with distance, countries and days beside it.',
      'Up close, the globe becomes a lens. The place the parcel came from stays on its rim, like a compass.',
      'The most object-like. Drag to spin it; the history below spells out the long hops.',
    ],
  },
];

const GROUPS: readonly JourneyGroup[] = ['Far', 'Near', 'Sparse'];
const WIDE = '(min-width: 1100px)';
const subscribe = () => () => {};
function subscribeToWidth(onChange: () => void) {
  const query = matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function MapStudy() {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const [direction, setDirection] = useState<Direction>('deck');
  const [journeyId, setJourneyId] = useState('world');
  const [steps, setSteps] = useState<Record<string, number>>({});
  const wide = useSyncExternalStore(subscribeToWidth, () => matchMedia(WIDE).matches, () => false);
  const [chosenDevice, setDevice] = useState<Device | null>(null);
  const device = chosenDevice ?? (wide ? 'desktop' : 'phone');
  const [theme, setTheme] = useState<Theme>('light');
  const [override, setOverride] = useState<MapMode | null>(null);
  const [playing, setPlaying] = useState(false);
  const journey = journeys.find(item => item.id === journeyId)!;
  const step = steps[journeyId] ?? journey.initialStep;
  const parcel = useMemo(() => snapshot(journey, step), [journey, step]);
  const mode = override ?? parcel.mode;
  const active = DIRECTIONS.find(item => item.id === direction)!;
  const last = journey.scans.length - 1;

  // Every new scan hands the camera back to the parcel.
  function goTo(next: number) {
    setSteps(previous => ({ ...previous, [journeyId]: Math.max(0, Math.min(last, next)) }));
    setOverride(null);
  }

  useEffect(() => {
    if (!playing || step >= last) return;
    const timer = setTimeout(() => {
      setSteps(previous => ({ ...previous, [journeyId]: step + 1 }));
      setOverride(null);
      if (step + 1 >= last) setPlaying(false);
    }, step === 0 ? 900 : 1900);
    return () => clearTimeout(timer);
  }, [playing, step, last, journeyId]);

  function play() {
    if (playing) return setPlaying(false);
    if (step >= last) goTo(0);
    setPlaying(true);
  }

  const View = direction === 'deck' ? Deck : direction === 'card' ? Card : Lens;
  const latestAt = new Date(parcel.latest.at);

  return <main className={styles.study} data-ready={ready} inert={!ready}>
    <header className={styles.studyHeader}>
      <Link href="/" className={styles.brand}><PeekMark size={20} /><span>Peek</span><span className={styles.badge}>Design study</span></Link>
    </header>
    <section className={styles.intro}>
      <p className={styles.eyebrow}>Near and far</p>
      <h1>Where has it been?</h1>
      <p>Three Flighty-inspired ways to show a parcel’s journey. The map changes with distance: a globe while the parcel is far away, a close-up once it is near.</p>
    </section>
    <div className={styles.directions} role="group" aria-label="Direction">
      {DIRECTIONS.map(item => <button key={item.id} type="button" aria-pressed={direction === item.id} onClick={() => setDirection(item.id)}>
        <span className={styles.directionNumber}>{item.number}</span>
        <strong>{item.name}</strong>
        <span>{item.summary}</span>
      </button>)}
    </div>
    <div className={styles.bench}>
      <aside className={styles.controls}>
        <fieldset className={styles.journeys}>
          <legend>Journey</legend>
          {GROUPS.map(group => <div key={group} className={styles.journeyGroup}>
            <span>{group}</span>
            <div>{journeys.filter(item => item.group === group).map(item => <button key={item.id} type="button"
              aria-pressed={journeyId === item.id} onClick={() => {
                setJourneyId(item.id);
                setOverride(null);
                setPlaying(false);
              }}>{item.name}</button>)}</div>
          </div>)}
        </fieldset>
        <div className={styles.scrubber}>
          <div className={styles.scrubberHead}>
            <span>Scan {step + 1} of {last + 1}</span>
            <button type="button" onClick={play} aria-label={playing ? 'Pause the journey' : 'Play the journey'} aria-pressed={playing}>
              {playing ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10M11 3v10" /></svg>
                : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l8 5-8 5V3Z" /></svg>}
              {playing ? 'Pause' : 'Play'}
            </button>
          </div>
          <input type="range" min={0} max={last} step={1} value={step} aria-label="Scan"
            onChange={event => {
              setPlaying(false);
              goTo(Number(event.target.value));
            }} />
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
          {active.notes.map(note => <p key={note}>{note}</p>)}
        </div>
      </aside>
      <section className={styles.preview} aria-label="Parcel preview">
        {ready && <Frame device={device} theme={theme} carrier={journey.carrier}>
          <View parcel={parcel} device={device} theme={theme} mode={mode} onMode={setOverride} />
        </Frame>}
      </section>
    </div>
    {/* On a phone the controls scroll away, so the essentials follow the preview. */}
    <div className={styles.dock} role="group" aria-label="Quick controls">
      <div role="group" aria-label="Direction">
        {DIRECTIONS.map(item => <button key={item.id} type="button" aria-pressed={direction === item.id}
          onClick={() => setDirection(item.id)}>{item.name}</button>)}
      </div>
      <button type="button" className={styles.dockJourney} onClick={() => {
        const next = journeys[(journeys.indexOf(journey) + 1) % journeys.length];
        setJourneyId(next.id);
        setOverride(null);
        setPlaying(false);
      }} aria-label={`Journey: ${journey.name}. Show the next journey`}>{journey.name}<Icon name="chevron" /></button>
      <button type="button" className={styles.dockPlay} onClick={play} aria-label={playing ? 'Pause the journey' : 'Play the journey'} aria-pressed={playing}>
        {playing ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10M11 3v10" /></svg>
          : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l8 5-8 5V3Z" /></svg>}
      </button>
    </div>
    <section className={styles.principles} aria-label="How the map decides">
      <Principle icon="globe" title="Far: a globe">Long routes are drawn as great circles on a globe seen slightly from the side, so they bow toward the pole the way flights do.</Principle>
      <Principle icon="location" title="Near: a close-up">Once the parcel is close, the view narrows to the last places. Where it started stays at the edge, with its distance.</Principle>
      <Principle icon="border" title="Only what was reported">A city is a dot. A country-only scan tints the country instead. Scans with no place stay off the map, and the lines between places are hops, not roads.</Principle>
      <Principle icon="truck" title="The camera follows">The whole trip while it travels, the close-up when it is out for delivery, the whole trip again once it has arrived. Press play to watch.</Principle>
    </section>
    <Atlas theme={theme} />
    <p className={styles.footnote}>Fictional parcels at city centres. Real scans carry only free text such as “ZUERICH, CH” or “Härkingen 4622”, so the app would geocode them on the server first. Map data: Natural Earth.</p>
  </main>;
}

const ATLAS: readonly { journey: string; step: number; mode?: MapMode; caption: string }[] = [
  { journey: 'world', step: 4, caption: 'Far · the whole trip on a globe' },
  { journey: 'world', step: 7, mode: 'now', caption: 'Far, now near · a close-up, the origin at the edge' },
  { journey: 'pacific', step: 3, caption: 'Over the Pacific · where a flat map would break' },
  { journey: 'regional', step: 4, caption: 'Across the border · a region with its countries' },
  { journey: 'local', step: 2, caption: 'Close to home · lakes and nearby cities' },
  { journey: 'city', step: 2, caption: 'Across town · the smallest useful area' },
  { journey: 'point', step: 1, caption: 'One place · a dot with its surroundings' },
  { journey: 'countries', step: 4, caption: 'Countries only · tinted, with a dotted hop' },
];

/** Every distance side by side, in the map's own style. The tiles never change, so they draw once per theme. */
const Atlas = memo(function Atlas({ theme }: { theme: Theme }) {
  const tiles = useMemo(() => ATLAS.map(tile => {
    const journey = journeys.find(item => item.id === tile.journey)!;
    return { ...tile, parcel: snapshot(journey, tile.step), brand: carrierBrand(carrierInfo(journey.carrier)).style };
  }), []);
  return <section className={styles.atlas} aria-label="Every distance at a glance">
    <p className={styles.eyebrow}>Every distance at a glance</p>
    <div className={styles.atlasGrid}>
      {tiles.map(tile => <figure key={`${tile.journey}-${tile.step}`}>
        <div className={styles.atlasTile} data-theme={theme} style={tile.brand}>
          <WorldMap route={tile.parcel.route} mode={tile.mode ?? 'journey'} time={tile.parcel.now} night labels="ends" redrawKey={theme}
            className={styles.atlasMap} />
        </div>
        <figcaption>{tile.caption}</figcaption>
      </figure>)}
    </div>
  </section>;
});

function Principle({ icon, title, children }: { icon: 'globe' | 'location' | 'border' | 'truck'; title: string; children: ReactNode }) {
  return <div><Icon name={icon} /><h3>{title}</h3><p>{children}</p></div>;
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
      <div className={styles.screen} data-theme={theme} style={carrierBrand(carrierInfo(carrier)).style}>{children}</div>
    </div>
  </div>;
}
