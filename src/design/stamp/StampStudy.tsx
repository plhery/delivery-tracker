'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { CarrierMark } from '../../components/CarrierMark';
import { Icon } from '../../components/Icon';
import { RouteEngraving, useParcelRoute } from '../../components/ParcelMap';
import { ProgressTrack } from '../../components/ProgressTrack';
import '../../components/Deliveries.css';
import '../../components/ParcelDetail.css';
import { localizedDatePhrase, localizedDeliveryWindow, localizedExpectedDelivery, useI18n } from '../../i18n';
import { carrierBrand } from '../../lib/carrierBrand';
import { carrierInfo, displayedCarrierId } from '../../lib/carriers';
import { parcelIcon } from '../../lib/parcelDesign';
import { localizedParcelCompletionDate, parcelDeliveryEstimate, parcelDisplayStatusKey } from '../../lib/parcelStatus';
import { countryName } from '../../lib/trackingLocation';
import { currentEvent, sortEventsDesc } from '../../lib/stages';
import { seedParcels } from '../../store/demoRepo';
import type { ParcelWithEvents } from '../../types';
import { Mark, type Direction, type MarkFacts } from './marks';
import styles from './study.module.css';

type Theme = 'light' | 'dark';

const DIRECTIONS: readonly { id: Direction; number: string; name: string; summary: string; notes: readonly string[] }[] = [
  {
    id: 'today', number: '00', name: 'Today', summary: 'The stamp as it ships.',
    notes: [
      'Its edges are cut in zigzags rather than round holes, and the teeth change size from card to card.',
      'Its postmark ring is cut off by the stamp’s own edge and sits on the glyph. Its shadow is cut off too.',
      'It is the same cream yellow on every carrier’s card, and in dark mode it is the brightest thing on the card.',
    ],
  },
  {
    id: 'recut', number: '01', name: 'Re-cut', summary: 'The same stamp, made properly.',
    notes: [
      'Round perforations at one even pitch, with a hole at each corner, on every card.',
      'Printed in the card’s own ink: DHL’s is yellow, Quickpac’s pink. In dark mode the paper takes the card’s colour instead of staying white.',
      'Clean while the parcel travels. When it is delivered, a postmark with the delivery date lands on the corner.',
      'The code at the foot is the country the parcel was posted from.',
    ],
  },
  {
    id: 'postmark', number: '02', name: 'Postmark', summary: 'Only the ink, saying where and when.',
    notes: [
      'No paper: a round date stamp in the card’s ink, like the one a sorting office leaves. It says where and when the parcel was last scanned.',
      'It is ink on the card, like the route drawn above it, so the opened card has one kind of drawing.',
      'Before any scan has a place, it carries the carrier’s name. Long place names shrink to fit the ring.',
    ],
  },
  {
    id: 'none', number: '03', name: 'None', summary: 'The name and the route carry the card.',
    notes: [
      'The name gets the whole width, and the opened card keeps the map as its only picture.',
      'Next up loses its counterweight and reads like the other cards, only bigger.',
      'The Passport and Friends keep their stamps, so the postal touch lives on there.',
    ],
  },
];

/** Demo parcels that cover a near route, a long one, no places yet, and a delivery. */
const SAMPLES = ['New sneakers 👟', 'Moon lamp 🌙', '35mm film rolls 🎞️', 'Coffee beans ☕'];

const subscribe = () => () => {};

function markFacts(parcel: ParcelWithEvents, languageTag: string, carrierName: string): MarkFacts {
  const current = currentEvent(parcel.events);
  const events = sortEventsDesc(parcel.events);
  const latest = events.find((event) => event.place);
  const origin = events.filter((event) => event.place).at(-1);
  const at = new Date(current?.occurredAt ?? parcel.createdAt);
  const country = latest?.place ? countryName(latest.place.country, languageTag) : '';
  return {
    icon: parcelIcon(current?.stage),
    delivered: current?.stage === 'delivered',
    place: (latest?.place?.precision === 'city' ? latest.place.name : carrierName).toLocaleUpperCase(languageTag),
    country: (country.length > 12 ? latest!.place!.country : country).toLocaleUpperCase(languageTag),
    origin: origin?.place?.country ?? '',
    date: new Intl.DateTimeFormat(languageTag, { day: '2-digit', month: '2-digit', year: '2-digit' }).format(at),
    dayMonth: new Intl.DateTimeFormat(languageTag, { day: '2-digit', month: '2-digit' }).format(at),
    time: new Intl.DateTimeFormat(languageTag, { hour: '2-digit', minute: '2-digit' }).format(at),
  };
}

function useParcelText(parcel: ParcelWithEvents) {
  const { locale, languageTag, t } = useI18n();
  const carrier = carrierInfo(displayedCarrierId(parcel), locale);
  const current = currentEvent(parcel.events);
  const estimate = parcelDeliveryEstimate(parcel);
  const completion = localizedParcelCompletionDate(parcel, languageTag, t);
  return {
    carrier, current, languageTag,
    name: parcel.label || t('common.parcel'),
    nextUp: t('app.nextUp'),
    status: t(parcelDisplayStatusKey(parcel)),
    expected: estimate ? localizedExpectedDelivery(estimate, t, languageTag) : null,
    arrival: completion ? localizedDatePhrase(completion, t)
      : estimate ? localizedDeliveryWindow(parcel.expectedDeliveryFrom, estimate, t, languageTag) : null,
    facts: markFacts(parcel, languageTag, carrier.name),
  };
}

/** The list's Next up card, with the markup and classes the app renders. */
function NextUp({ parcel, direction }: { parcel: ParcelWithEvents; direction: Direction }) {
  const text = useParcelText(parcel);
  return <div style={carrierBrand(text.carrier).style} className="parcel-card-swipe parcel-card-swipe--hero">
    <div className="parcel-card-swipe__clip">
      <button type="button" className="parcel-card parcel-card--hero">
        <span className="parcel-card__hero-top"><CarrierMark carrier={text.carrier} /><span className="parcel-card__next-label">{text.nextUp}</span></span>
        <span className="parcel-card__hero-main"><strong className="parcel-card__label">{text.name}</strong><Mark direction={direction} facts={text.facts} /></span>
        <span className="parcel-card__summary"><span className="parcel-card__state">{text.status}</span>
          {text.expected && <><span aria-hidden="true">·</span><span className="parcel-card__eta">{text.expected}</span></>}</span>
      </button>
    </div>
  </div>;
}

/** The top of the opened parcel, with the markup and classes the app renders. */
function Opened({ parcel, direction, dropBesideMap }: { parcel: ParcelWithEvents; direction: Direction; dropBesideMap: boolean }) {
  const text = useParcelText(parcel);
  const { placed, route } = useParcelRoute(parcel, text.languageTag);
  const stage = text.current?.stage;
  return <div style={carrierBrand(text.carrier).style} className={`detail detail--postcard ${styles.opened}`}>
    <section className={`detail__hero${placed ? ' detail__hero--map' : ''}`}>
      {placed && <RouteEngraving route={route} stage={stage} onOpen={() => {}} />}
      <div className="detail__hero-meta">
        <button type="button" className="detail__carrier"><CarrierMark carrier={text.carrier} /></button>
        <span className="detail__hero-actions">
          {placed && <button type="button" className="detail__map-button" aria-label="Open the map"><Icon name="globe" /></button>}
          <button type="button" className="detail__notification" aria-label="Mute"><Icon name="bell" /></button>
        </span>
      </div>
      <div className="detail__title-row">
        <h2 className="detail__title">{text.name}</h2>
        {!(placed && dropBesideMap) && <Mark direction={direction} facts={text.facts} />}
      </div>
      <p className="detail__state">{text.status}</p>
      {text.arrival && <p className="detail__arrival">{text.arrival}</p>}
      <div className="detail__progress"><ProgressTrack stage={stage ?? null} /></div>
    </section>
  </div>;
}

/** The mark alone, large, on three carriers' cards. */
function Specimens({ parcels, direction }: { parcels: ParcelWithEvents[]; direction: Direction }) {
  if (direction === 'none') return <p className={styles.specimenEmpty}>Nothing to look at closely: the card has no mark.</p>;
  return <div className={styles.specimens}>
    {parcels.map((parcel) => <Specimen key={parcel.id} parcel={parcel} direction={direction} />)}
  </div>;
}

function Specimen({ parcel, direction }: { parcel: ParcelWithEvents; direction: Direction }) {
  const text = useParcelText(parcel);
  return <figure style={carrierBrand(text.carrier).style} className={styles.specimen}>
    <div className={styles.specimenMark}><Mark direction={direction} facts={text.facts} /></div>
    <figcaption>{text.carrier.name} · {text.status}</figcaption>
  </figure>;
}

function Column({ theme, parcels, direction, dropBesideMap }: { theme: Theme; parcels: ParcelWithEvents[]; direction: Direction; dropBesideMap: boolean }) {
  const waiting = parcels.filter((parcel) => currentEvent(parcel.events)?.stage !== 'delivered');
  return <div className={styles.theme} data-theme={theme}>
    <p className={styles.eyebrow}>{theme === 'light' ? 'Light' : 'Dark'}</p>
    <h3 className={styles.shelfTitle}>Up close</h3>
    <Specimens parcels={waiting.slice(0, 2).concat(parcels.filter((parcel) => !waiting.includes(parcel)))} direction={direction} />
    <h3 className={styles.shelfTitle}>Opened</h3>
    <div className={styles.shelf}>
      {parcels.map((parcel) => <Opened key={parcel.id} parcel={parcel} direction={direction} dropBesideMap={dropBesideMap} />)}
    </div>
    <h3 className={styles.shelfTitle}>Next up, in the list</h3>
    <div className={`app--deliveries ${styles.shelf}`}>
      {waiting.map((parcel) => <NextUp key={parcel.id} parcel={parcel} direction={direction} />)}
    </div>
  </div>;
}

export function StampStudy() {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const [direction, setDirection] = useState<Direction>('recut');
  const [theme, setTheme] = useState<Theme>('light');
  const [dropBesideMap, setDropBesideMap] = useState(false);
  // Demo dates count back from now; the cards only render in the browser, once ready.
  const [parcels] = useState(() => {
    const seeded = seedParcels(Date.now());
    return SAMPLES.map((label) => seeded.find((parcel) => parcel.label === label)!);
  });
  const active = DIRECTIONS.find((item) => item.id === direction)!;

  return <main className={styles.study} data-ready={ready} inert={!ready}>
    <header className={styles.studyHeader}>
      <Link href="/" className={styles.brand}><Icon name="parcel" /><span>Delivery Tracker</span><span className={styles.badge}>Design study</span></Link>
    </header>
    <section className={styles.intro}>
      <p className={styles.eyebrow}>The stamp</p>
      <h1>What sits beside the name?</h1>
      <p>The stamp gives the card a postal touch, but it is roughly made. Here are ways to make it properly, swap it for a postmark, or drop it, shown on the demo parcels.</p>
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
        <div className={styles.notes}>
          <p className={styles.eyebrow}>{active.name}</p>
          {active.notes.map((note) => <p key={note}>{note}</p>)}
        </div>
        <div className={styles.toggles}>
          <div role="group" aria-label="Theme" className={styles.themeToggle}>
            {(['light', 'dark'] as const).map((value) => <button key={value} type="button" aria-pressed={theme === value} onClick={() => setTheme(value)}>
              {value === 'light' ? 'Light' : 'Dark'}
            </button>)}
          </div>
          <label className={styles.check}>
            <input type="checkbox" checked={dropBesideMap} onChange={(event) => setDropBesideMap(event.target.checked)} />
            <span>Leave it out when the opened card shows a map</span>
          </label>
        </div>
      </aside>
      <section className={styles.columns} data-theme={theme} aria-label="Cards">
        {ready && (['light', 'dark'] as const).map((value) => <Column key={value} theme={value} parcels={parcels} direction={direction} dropBesideMap={dropBesideMap} />)}
      </section>
    </div>
  </main>;
}
