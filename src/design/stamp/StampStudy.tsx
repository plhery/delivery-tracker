'use client';

import Link from 'next/link';
import { Fragment, useState, useSyncExternalStore } from 'react';
import { Icon } from '../../components/Icon';
import { useWorld } from '../../components/map/geography';
import '../../components/Deliveries.css';
import '../../components/ParcelDetail.css';
import { useI18n } from '../../i18n';
import { carrierBrand } from '../../lib/carrierBrand';
import { carrierInfo, displayedCarrierId } from '../../lib/carriers';
import { currentEvent } from '../../lib/stages';
import { seedParcels } from '../../store/demoRepo';
import type { ParcelWithEvents } from '../../types';
import { NextUpCard, OpenedCard, type CardDesign } from './cards';
import { stampFacts } from './facts';
import { MOTIFS, type MotifId } from './motifs';
import { Stamp, type Caption, type Edge, type PostmarkStyle, type PrintStyle, type StampDesign } from './stamps';
import styles from './study.module.css';

type Theme = 'light' | 'dark';

const LAYOUTS: readonly { id: CardDesign; number: string; name: string; summary: string; note: string }[] = [
  { id: 'today', number: 'A', name: 'Today’s card', summary: 'The stamp beside the name.', note: 'The card as it ships, so each stamp can be judged on its own.' },
  { id: 'envelope', number: 'B', name: 'Envelope', summary: 'The stamp where a letter has it.', note: 'The stamp moves to the top right corner, where it goes on a letter. A parcel that has crossed a border gets an airmail edge.' },
  { id: 'postcard', number: 'C', name: 'Postcard', summary: 'The back of a card, with a message.', note: 'The carrier’s latest words on the left, like a message, and the stamp and the address on the right. The route moves behind the globe button.' },
  { id: 'stamp', number: 'D', name: 'Stamp card', summary: 'The whole card is a stamp.', note: 'The card itself is cut like a stamp, with the stamp’s print set on it.' },
];

function Choice<T extends string>({ label, value, options, onChange, className }: {
  label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void; className?: string;
}) {
  return <div className={`${styles.pickerRow} ${className ?? ''}`}>
    <span className={styles.pickerLabel}>{label}</span>
    <div role="group" aria-label={label} className={styles.chips}>
      {options.map(([id, name]) => <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>{name}</button>)}
    </div>
  </div>;
}

/** Demo parcels posted in five places, two of them delivered, one not yet scanned anywhere. */
const SHEET = ['New sneakers 👟', 'Birthday gift 🎁', 'Matcha ritual 🍵', 'Coffee beans ☕', '35mm film rolls 🎞️'];
/** Parcels for the cards: a near route, a far one delivered, no places yet, and a domestic delivery. */
const CARDS = ['New sneakers 👟', 'Matcha ritual 🍵', '35mm film rolls 🎞️', 'Coffee beans ☕'];

const subscribe = () => () => {};

function SheetTile({ parcel, design, world }: { parcel: ParcelWithEvents; design: StampDesign; world: boolean }) {
  const { locale, languageTag, t } = useI18n();
  const carrier = carrierInfo(displayedCarrierId(parcel), locale);
  return <div role="cell" style={carrierBrand(carrier).style} className={styles.sheetTile}>
    <div className={styles.sheetStamp}><Stamp design={design} facts={stampFacts(parcel, carrier.name, languageTag, t)} world={world} /></div>
  </div>;
}

function SheetHead({ parcel }: { parcel: ParcelWithEvents }) {
  const { locale, languageTag, t } = useI18n();
  const carrier = carrierInfo(displayedCarrierId(parcel), locale);
  const facts = stampFacts(parcel, carrier.name, languageTag, t);
  return <span role="columnheader" className={styles.sheetHead}>
    <strong>{carrier.name}</strong>
    <span>{facts.origin ? `from ${facts.origin}` : 'no scan yet'}{facts.delivered ? ' · delivered' : ''}</span>
  </span>;
}

/** Every motif for every sample parcel, with the chosen edge, print, caption and postmark. */
function Sheet({ theme, parcels, style, active, world, onPick }: {
  theme: Theme; parcels: ParcelWithEvents[]; style: Omit<StampDesign, 'motif'>; active: MotifId; world: boolean; onPick: (motif: MotifId) => void;
}) {
  const groups: readonly { title: string; rows: readonly { id: MotifId | 'today'; name: string }[] }[] = [
    { title: 'As it ships', rows: [{ id: 'today', name: 'Today' }] },
    { title: 'The same on every parcel', rows: MOTIFS.filter((item) => item.group === 'same') },
    { title: 'From the country it was posted in', rows: MOTIFS.filter((item) => item.group === 'country') },
  ];
  return <div className={styles.theme} data-theme={theme}>
    <p className={styles.eyebrow}>{theme === 'light' ? 'Light' : 'Dark'}</p>
    <div className={styles.sheet} role="table" aria-label={`Stamps, ${theme}`}>
      <div role="row" className={styles.sheetRow}>
        <span role="columnheader" />
        {parcels.map((parcel) => <SheetHead key={parcel.id} parcel={parcel} />)}
      </div>
      {groups.map((group) => <Fragment key={group.title}>
        <p className={styles.sheetGroup}>{group.title}</p>
        {group.rows.map((row) => <div role="row" key={row.id} className={styles.sheetRow} data-active={row.id === active || undefined}>
          <span role="rowheader" className={styles.sheetName}>
            {row.id === 'today' ? <span>{row.name}</span>
              : <button type="button" aria-pressed={row.id === active} onClick={() => onPick(row.id as MotifId)}>{row.name}</button>}
          </span>
          {parcels.map((parcel) => <SheetTile key={parcel.id} parcel={parcel} design={{ ...style, motif: row.id }} world={world} />)}
        </div>)}
      </Fragment>)}
    </div>
  </div>;
}

function Column({ theme, parcels, layout, stamp, world, dropBesideMap }: {
  theme: Theme; parcels: ParcelWithEvents[]; layout: CardDesign; stamp: StampDesign; world: boolean; dropBesideMap: boolean;
}) {
  const waiting = parcels.filter((parcel) => currentEvent(parcel.events)?.stage !== 'delivered');
  return <div className={styles.theme} data-theme={theme}>
    <p className={styles.eyebrow}>{theme === 'light' ? 'Light' : 'Dark'}</p>
    <h3 className={styles.shelfTitle}>Opened</h3>
    <div className={styles.shelf}>
      {parcels.map((parcel) => <OpenedCard key={parcel.id} parcel={parcel} design={layout} stamp={stamp} world={world} dropBesideMap={dropBesideMap} />)}
    </div>
    <h3 className={styles.shelfTitle}>Next up, in the list</h3>
    <div className={`app--deliveries ${styles.shelf}`}>
      {waiting.map((parcel) => <NextUpCard key={parcel.id} parcel={parcel} design={layout} stamp={stamp} world={world} />)}
    </div>
  </div>;
}

export function StampStudy() {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const world = useWorld(true);
  const [motif, setMotif] = useState<MotifId>('globe');
  const [edge, setEdge] = useState<Edge>('perforated');
  const [print, setPrint] = useState<PrintStyle>('tinted');
  const [caption, setCaption] = useState<Caption>('code');
  const [postmark, setPostmark] = useState<PostmarkStyle>('ring');
  const [layout, setLayout] = useState<CardDesign>('today');
  const [theme, setTheme] = useState<Theme>('light');
  const [dropBesideMap, setDropBesideMap] = useState(false);
  // Demo dates count back from now; the stamps only render in the browser, once ready.
  const [parcels] = useState(() => {
    const seeded = seedParcels(Date.now());
    const find = (label: string) => seeded.find((parcel) => parcel.label === label)!;
    return { sheet: SHEET.map(find), cards: CARDS.map(find) };
  });
  const style = { edge, print, caption, postmark };
  const stamp: StampDesign = { ...style, motif };
  const activeMotif = MOTIFS.find((item) => item.id === motif)!;
  const activeLayout = LAYOUTS.find((item) => item.id === layout)!;
  const themes = ['light', 'dark'] as const;

  return <main className={styles.study} data-ready={ready} inert={!ready}>
    <header className={styles.studyHeader}>
      <Link href="/" className={styles.brand}><Icon name="parcel" /><span>Delivery Tracker</span><span className={styles.badge}>Design study</span></Link>
    </header>
    <section className={styles.intro}>
      <p className={styles.eyebrow}>The stamp · round three</p>
      <h1>A stamp, not a status</h1>
      <p>The status icon leaves the stamp. What it shows instead stays the same on every parcel, or comes from the country the parcel was posted in. The stamp is clean-cut, and the postmark lands only once the parcel arrives.</p>
    </section>

    <div className={styles.picker}>
      <Choice label="Edge" value={edge} onChange={setEdge} options={[['perforated', 'Perforated'], ['diecut', 'Die-cut']]} />
      <Choice label="Print" value={print} onChange={setPrint} options={[['tinted', 'Tinted'], ['engraved', 'Engraved'], ['ink', 'Ink'], ['paper', 'Paper']]} />
      <Choice label="Caption" value={caption} onChange={setCaption} options={[['none', 'None'], ['code', 'Code'], ['name', 'Country']]} />
      <Choice label="Postmark" value={postmark} onChange={setPostmark} options={[['ring', 'Date'], ['town', 'Town and date'], ['waves', 'Machine']]} />
      <Choice label="Theme" value={theme} onChange={setTheme} className={styles.themeRow} options={[['light', 'Light'], ['dark', 'Dark']]} />
    </div>

    <section className={styles.sheets} data-theme={theme} aria-label="Stamp sheet">
      {ready && themes.map((value) => <Sheet key={value} theme={value} parcels={parcels.sheet} style={style} active={motif} world={world} onPick={setMotif} />)}
    </section>

    <h2 className={styles.sectionTitle}>On the card</h2>
    <div role="group" aria-label="Motif" className={styles.chips}>
      {MOTIFS.map((item) => <button key={item.id} type="button" aria-pressed={motif === item.id} onClick={() => setMotif(item.id)}>{item.name}</button>)}
    </div>
    <div className={styles.directions} role="group" aria-label="Card">
      {LAYOUTS.map((item) => <button key={item.id} type="button" aria-pressed={layout === item.id} onClick={() => setLayout(item.id)}>
        <span className={styles.directionNumber}>{item.number}</span>
        <strong>{item.name}</strong>
        <span>{item.summary}</span>
      </button>)}
    </div>
    <div className={styles.bench}>
      <aside className={styles.controls}>
        <div className={styles.notes}>
          <p className={styles.eyebrow}>{activeMotif.name}</p>
          <p>{activeMotif.note}</p>
          <p className={styles.eyebrow}>{activeLayout.name}</p>
          <p>{activeLayout.note}</p>
        </div>
        <div className={styles.toggles}>
          <label className={styles.check}>
            <input type="checkbox" checked={dropBesideMap} onChange={(event) => setDropBesideMap(event.target.checked)} />
            <span>Leave the stamp out when the opened card shows a map</span>
          </label>
        </div>
      </aside>
      <section className={styles.columns} data-theme={theme} aria-label="Cards">
        {ready && themes.map((value) => <Column key={value} theme={value} parcels={parcels.cards} layout={layout} stamp={stamp}
          world={world} dropBesideMap={dropBesideMap} />)}
      </section>
    </div>
  </main>;
}
