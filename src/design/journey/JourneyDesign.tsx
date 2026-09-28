'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { CarrierMark } from '../../components/CarrierMark';
import { carrierInfo } from '../../lib/carriers';
import { carrierBrand } from '../../lib/carrierBrand';
import { Icon, PostageStamp } from '../../components/Icon';
import { JourneyMap } from './JourneyMap';
import { flag, journeyScenarios, type JourneyScenario, type JourneyStop } from './scenarios';
import styles from './journey.module.css';

type Direction = 'postcard' | 'hero' | 'atlas';
type Scope = 'journey' | 'arrival';
const subscribeToHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
const directions: readonly { id: Direction; number: string; name: string; summary: string; detail: string }[] = [
  { id: 'postcard', number: '01', name: 'Route postcard', summary: 'A quiet addition to the parcel.', detail: 'The status stays first. A compact map sits between the parcel card and its history, with every reported stop one tap away.' },
  { id: 'hero', number: '02', name: 'Map first', summary: 'The journey takes the foreground.', detail: 'A larger map becomes the parcel’s cover. The arrival and latest scan sit on the map, giving long journeys more room.' },
  { id: 'atlas', number: '03', name: 'Journey atlas', summary: 'Places and scans, side by side.', detail: 'A map and an itinerary work together. Pick a stop to see its scan. On a phone, the itinerary moves below the map.' },
];

export function JourneyDesign() {
  const ready = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [direction, setDirection] = useState<Direction>('postcard');
  const [scenarioId, setScenarioId] = useState('world');
  const [phone, setPhone] = useState(false);
  const [dark, setDark] = useState(false);
  const [scope, setScope] = useState<Scope>('journey');
  const [selectedId, setSelectedId] = useState<string | null>('harkingen');
  const scenario = journeyScenarios.find(item => item.id === scenarioId)!;
  const activeDirection = directions.find(item => item.id === direction)!;
  const selected = scenario.stops.find(stop => stop.id === selectedId) ?? scenario.stops.at(-1);
  const arrivalStops = scenario.stops.filter(stop => stop.countryCode === scenario.stops.at(-1)?.countryCode);
  const canFocusArrival = arrivalStops.length > 1 && arrivalStops.length < scenario.stops.length;
  const visibleStops = scope === 'arrival' && canFocusArrival ? arrivalStops : scenario.stops;
  const carrier = carrierInfo(scenario.carrier === 'DHL' ? 'dhl' : 'swiss-post');

  function changeScenario(id: string) {
    const next = journeyScenarios.find(item => item.id === id)!;
    setScenarioId(id);
    setSelectedId(next.stops.at(-1)?.id ?? null);
    setScope('journey');
  }

  function selectStop(id: string) {
    setSelectedId(id);
    if (scope === 'arrival' && !arrivalStops.some(stop => stop.id === id)) setScope('journey');
  }

  const map = <JourneyMap stops={visibleStops} allStops={scenario.stops} selectedId={selected?.id ?? null}
    onSelect={selectStop} latestHasLocation={scenario.latestHasLocation} cover={direction === 'hero'} />;
  const controls = canFocusArrival ? <div className={styles.scopeControl} role="group" aria-label="Map area">
    <button type="button" aria-pressed={scope === 'journey'} onClick={() => setScope('journey')}>Whole journey</button>
    <button type="button" aria-pressed={scope === 'arrival'} onClick={() => {
      setScope('arrival');
      if (!arrivalStops.some(stop => stop.id === selectedId)) setSelectedId(arrivalStops.at(-1)!.id);
    }}>Near arrival</button>
  </div> : null;

  return <main className={styles.study} lang="en" data-ready={ready} inert={!ready}>
    <header className={styles.studyHeader}>
      <Link href="/" className={styles.brand}><Icon name="parcel" /><span>Delivery Tracker</span><span className={styles.studyBadge}>Design study</span></Link>
      <a href="https://flighty.com" target="_blank" rel="noopener noreferrer" className={styles.reference}>Inspired by Flighty <Icon name="arrow" /></a>
    </header>
    <div className={styles.intro}>
      <p className={styles.eyebrow}>A sense of place</p>
      <h1>Every parcel has a journey.</h1>
      <p>Three ways to bring it into view.</p>
    </div>
    <div className={styles.directionControl} role="group" aria-label="Design direction">
      {directions.map(item => <button key={item.id} type="button" onClick={() => setDirection(item.id)} aria-pressed={direction === item.id}>
        <span className={styles.directionNumber}>{item.number}</span><span>{item.name}</span>
        {item.id === 'postcard' && <span className={styles.recommendation}>Recommended</span>}
      </button>)}
    </div>
    <div className={styles.workbench}>
      <aside className={styles.notes}>
        <p className={styles.eyebrow}>{activeDirection.number} / The direction</p>
        <h2>{activeDirection.summary}</h2>
        <p>{activeDirection.detail}</p>
        <fieldset className={styles.scenarios}><legend>Try a journey</legend>
          {journeyScenarios.map(item => <label key={item.id}>
            <input type="radio" name="journey" value={item.id} checked={scenarioId === item.id} onChange={() => changeScenario(item.id)} />
            <span>{item.name}</span><span className={styles.scenarioArrow} aria-hidden="true">↗</span>
          </label>)}
        </fieldset>
        <div className={styles.designNote}>
          <Icon name="location" />
          <p>A map of <strong>reported stops</strong>. Connections suggest the journey; they don’t claim a road, flight, or live position.</p>
        </div>
        <p className={styles.fixtureNote}>Fictional parcels · City-level locations</p>
      </aside>
      <section className={styles.previewColumn} aria-label="Parcel design preview">
        <div className={styles.previewToolbar}>
          <div role="group" aria-label="Preview size" className={styles.deviceControl}>
            <button type="button" aria-pressed={!phone} onClick={() => setPhone(false)}><MonitorIcon />Desktop</button>
            <button type="button" aria-pressed={phone} onClick={() => setPhone(true)}><PhoneIcon />Phone</button>
          </div>
          <button className={styles.themeControl} type="button" aria-pressed={dark} aria-label="Dark preview" onClick={() => setDark(value => !value)}>
            <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M16.8 11A7 7 0 0 1 9 3.2 7 7 0 1 0 16.8 11Z" /></svg>
          </button>
        </div>
        <div className={styles.previewCanvas}>
          <article className={styles.parcelPreview} data-phone={phone} data-theme={dark ? 'dark' : 'light'} data-direction={direction} style={carrierBrand(carrier).style}>
            <div className={styles.parcelNavigation}><span><Icon name="back" />Back</span><span>Parcel</span><span aria-hidden="true">•••</span></div>
            {direction === 'hero' ? <>
              <div className={styles.heroCover}>
                {map}
                <div className={styles.heroTitle}><CarrierMark carrier={carrier} /><h2>{scenario.label}</h2></div>
                <div className={styles.heroControls}>{controls}</div>
              </div>
              <div className={styles.heroStatus}><Status scenario={scenario} /><PostageStamp icon={scenario.status === 'Out for delivery' ? 'truck' : 'parcel'} /></div>
              <JourneySummary scenario={scenario} selected={selected} />
              <StopStrip stops={scenario.stops} selectedId={selected?.id} onSelect={selectStop} />
            </> : <>
              <div className={styles.parcelHero}><div className={styles.parcelHeroTop}><CarrierMark carrier={carrier} /><BellIcon /></div>
                <div className={styles.parcelTitle}><h2>{scenario.label}</h2><PostageStamp icon={scenario.status === 'Out for delivery' ? 'truck' : 'parcel'} /></div>
                <Status scenario={scenario} /><Progress outForDelivery={scenario.status === 'Out for delivery'} empty={!scenario.stops.length} />
              </div>
              <div className={styles.journeyCard}>
                <div className={styles.journeyHeading}><div><h3>The journey</h3><span>{journeyCount(scenario.stops)}</span></div>{controls}</div>
                {direction === 'postcard' ? <>{map}<JourneySummary scenario={scenario} selected={selected} /><StopStrip stops={scenario.stops} selectedId={selected?.id} onSelect={selectStop} /></>
                  : <div className={styles.atlasLayout}><div className={styles.atlasMap}>{map}<JourneySummary scenario={scenario} selected={selected} /></div>
                    <Itinerary stops={scenario.stops} selectedId={selected?.id} onSelect={selectStop} latestHasLocation={scenario.latestHasLocation} /></div>}
              </div>
            </>}
            {selected && <div className={styles.scanDetail} aria-live="polite"><span className={styles.scanDot} /><div><p>{selected.description}</p><span>{selected.city}, {selected.country} · {selected.date}, {selected.time}</span></div></div>}
            {!scenario.latestHasLocation && <p className={styles.locationCaveat}>{scenario.stops.length ? 'The latest update has no location. Showing the last known stop.' : 'Your parcel is registered. We’re waiting for the carrier to report its first location.'}</p>}
            {direction !== 'atlas' && <History scenario={scenario} />}
            <footer className={styles.parcelFooter}><span>Sample parcel · No live tracking</span><span>Delivery Tracker</span></footer>
          </article>
        </div>
        <div className={styles.previewCaption}><span>{activeDirection.name}</span><span>{scenario.stops.length > 1 ? 'Tap a place to explore its scan' : 'Location detail adapts to the available scans'}</span></div>
      </section>
    </div>
    <section className={styles.scaleNotes} aria-label="How the map adapts">
      <ScaleNote icon={<Icon name="globe" />} title="Far away" description="An atlas, curved connections, and the whole journey. Nearby scans share a marker until you zoom in." />
      <ScaleNote icon={<Icon name="location" />} title="Getting closer" description="A regional view with clearer city labels. Switch to the arrival region while keeping the full journey available." />
      <ScaleNote icon={<Icon name="parcel" />} title="Less to go on" description="One known location gets a single marker. No locations gets a small, honest waiting state." />
    </section>
  </main>;
}

function journeyCount(stops: readonly JourneyStop[]): string {
  if (!stops.length) return 'Waiting for a location';
  const countries = new Set(stops.map(stop => stop.countryCode)).size;
  return `${stops.length} ${stops.length === 1 ? 'place' : 'places'} · ${countries} ${countries === 1 ? 'country' : 'countries'}`;
}

function Status({ scenario }: { scenario: JourneyScenario }) {
  return <div className={styles.status}><p><span />{scenario.status}</p><span>{scenario.arrival}</span></div>;
}

function JourneySummary({ scenario, selected }: { scenario: JourneyScenario; selected?: JourneyStop }) {
  if (!selected) return null;
  const origin = scenario.stops[0];
  const current = scenario.stops.at(-1)?.id === selected.id;
  if (scenario.stops.length === 1) return <div className={styles.singleStopSummary}><span>Last known location</span><strong><span aria-hidden="true">{flag(selected.countryCode)}</span> {selected.city}, {selected.country}</strong></div>;
  return <div className={styles.journeySummary}>
    <div><span>From</span><strong><span aria-hidden="true">{flag(origin.countryCode)}</span> {origin.city}</strong></div>
    <span className={styles.summaryConnection} aria-hidden="true">·········<Icon name="parcel" />·········</span>
    <div><span>{current ? scenario.latestHasLocation ? 'Last reported' : 'Last known' : 'Reported stop'}</span><strong><span aria-hidden="true">{flag(selected.countryCode)}</span> {selected.city}</strong></div>
  </div>;
}

function StopStrip({ stops, selectedId, onSelect }: { stops: readonly JourneyStop[]; selectedId?: string; onSelect: (id: string) => void }) {
  if (stops.length < 2) return null;
  return <div className={styles.stopStrip} role="group" aria-label="Reported places">{stops.map((stop, index) => <button key={stop.id} type="button" aria-pressed={selectedId === stop.id} onClick={() => onSelect(stop.id)}><span>{String(index + 1).padStart(2, '0')}</span>{stop.city}</button>)}</div>;
}

function Itinerary({ stops, selectedId, onSelect, latestHasLocation }: { stops: readonly JourneyStop[]; selectedId?: string; onSelect: (id: string) => void; latestHasLocation: boolean }) {
  if (!stops.length) return null;
  return <ol className={styles.itinerary} aria-label="Journey itinerary">{stops.map((stop, index) => <li key={stop.id}>
    <button type="button" onClick={() => onSelect(stop.id)} aria-pressed={selectedId === stop.id}>
      <span className={styles.itineraryMarker} data-current={index === stops.length - 1 && latestHasLocation}>{String(index + 1).padStart(2, '0')}</span>
      <span className={styles.itineraryText}><strong>{stop.city}<span aria-hidden="true">{flag(stop.countryCode)}</span></strong><span>{stop.description}</span><small>{stop.date} · {stop.time}</small></span>
    </button>
  </li>)}</ol>;
}

function History({ scenario }: { scenario: JourneyScenario }) {
  if (!scenario.stops.length) return null;
  return <details open className={styles.history}><summary><span>Tracking history</span><span>{scenario.stops.length} updates <Icon name="chevron" /></span></summary>
    <p className={styles.historyDay}>Today</p><div className={styles.historyScan}><span>{scenario.latestHasLocation ? scenario.stops.at(-1)!.time : '12:08'}</span><div><p>{scenario.latestHasLocation ? scenario.stops.at(-1)!.description : 'On the way to the next facility'}</p><span>{scenario.latestHasLocation ? `${scenario.stops.at(-1)!.city}, ${scenario.stops.at(-1)!.country}` : 'No location reported'}</span></div></div>
    <div className={styles.historyEarlier}><span />{scenario.stops.length > 1 ? `${scenario.stops.length - 1} earlier scans along the journey` : 'The map shows the last located scan'}</div>
  </details>;
}

function Progress({ outForDelivery, empty }: { outForDelivery: boolean; empty: boolean }) {
  return <div className={styles.progress} aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i} data-filled={i < (empty ? 1 : outForDelivery ? 5 : 4)} />)}</div>;
}

function ScaleNote({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <div>{icon}<h3>{title}</h3><p>{description}</p></div>;
}

function MonitorIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><rect x="2.5" y="3.5" width="15" height="10" rx="1.5" /><path d="M10 14v3m-4 0h8" /></svg>;
}

function PhoneIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><rect x="5" y="2" width="10" height="16" rx="2" /><path d="M8 5h4m-3 10h2" /></svg>;
}

function BellIcon() {
  return <svg className={styles.bell} aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m7 12h4" /></svg>;
}
