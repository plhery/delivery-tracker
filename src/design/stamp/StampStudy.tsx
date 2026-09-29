'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
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
import { Stamp, type PostmarkMode, type StampKind } from './stamps';
import styles from './study.module.css';

type Theme = 'light' | 'dark';

const DESIGNS: readonly { id: CardDesign; number: string; name: string; summary: string; note: string }[] = [
  {
    id: 'today', number: 'A', name: 'Today’s card', summary: 'The stamp beside the name.',
    note: 'The card as it ships, so each stamp can be judged on its own.',
  },
  {
    id: 'envelope', number: 'B', name: 'Envelope', summary: 'The stamp where a letter has it.',
    note: 'The stamp moves to the top right corner, where it goes on a letter, and the carrier sits top left like a return address. A parcel that has crossed a border gets an airmail edge. The bell and the globe move down beside the status.',
  },
  {
    id: 'postcard', number: 'C', name: 'Postcard', summary: 'The back of a card, with a message.',
    note: 'The opened card as the back of a postcard: the carrier’s latest words on the left, like a message, and the stamp and the address on the right. The route moves behind the globe button.',
  },
  {
    id: 'stamp', number: 'D', name: 'Stamp card', summary: 'The whole card is a stamp.',
    note: 'The card itself is cut like a stamp: perforated paper around the carrier’s colour, with the route and the picture printed on it.',
  },
];

const KINDS: readonly { id: StampKind; name: string; note: string }[] = [
  { id: 'today', name: 'Today', note: 'The stamp as it ships: zigzag edges, a clipped postmark ring, cream yellow on every card.' },
  { id: 'clean', name: 'Clean cut', note: 'Round holes at one pitch, printed in the card’s colours. The code is the country the parcel was posted from.' },
  { id: 'engraved', name: 'Engraved', note: 'A stamp from the country the parcel was posted in: its name as its own stamps spell it, its outline with the sea in engraved lines, and the kilometres so far as the value.' },
  { id: 'picture', name: 'Picture', note: 'A small scene for each step: the parcel waiting, the post office, a truck in the mountains, the van in town, the parcel at the door. In dark mode they turn into night scenes.' },
  { id: 'inside', name: 'Inside', note: 'The emoji at the end of the name becomes the stamp’s picture, so every parcel gets a stamp of its own. Names without one keep the step’s glyph.' },
];

const POSTMARKS: readonly { id: PostmarkMode; name: string; note: string }[] = [
  { id: 'off', name: 'None', note: 'The stamp stays clean.' },
  { id: 'delivered', name: 'On delivery', note: 'A dated ring lands on the stamp once the parcel arrives.' },
  { id: 'always', name: 'Always', note: 'A sorting machine’s cancel, dated with the last scan, with its waves running off the card.' },
];

/** Demo parcels that cover a near route, a long one, no places yet, and a delivery. */
const SAMPLES = ['New sneakers 👟', 'Moon lamp 🌙', '35mm film rolls 🎞️', 'Coffee beans ☕'];

const subscribe = () => () => {};

function SheetTile({ parcel, kind, postmark, world }: { parcel: ParcelWithEvents; kind: StampKind; postmark: PostmarkMode; world: boolean }) {
  const { locale, languageTag, t } = useI18n();
  const carrier = carrierInfo(displayedCarrierId(parcel), locale);
  const facts = stampFacts(parcel, parcel.label, carrier.name, languageTag, t);
  return <div role="cell" style={carrierBrand(carrier).style} className={styles.sheetTile}>
    <div className={styles.sheetStamp}><Stamp kind={kind} facts={facts} postmark={postmark} world={world} /></div>
  </div>;
}

/** Every stamp for every sample parcel, twice their size. */
function Sheet({ theme, parcels, active, postmark, world, onPick }: {
  theme: Theme; parcels: ParcelWithEvents[]; active: StampKind; postmark: PostmarkMode; world: boolean; onPick: (kind: StampKind) => void;
}) {
  const { locale } = useI18n();
  return <div className={styles.theme} data-theme={theme}>
    <p className={styles.eyebrow}>{theme === 'light' ? 'Light' : 'Dark'}</p>
    <div className={styles.sheet} role="table" aria-label={`Stamps, ${theme}`}>
      <div role="row" className={styles.sheetRow}>
        <span role="columnheader" />
        {parcels.map((parcel) => <span role="columnheader" key={parcel.id} className={styles.sheetHead}>
          {carrierInfo(displayedCarrierId(parcel), locale).name}
        </span>)}
      </div>
      {KINDS.map((kind) => <div role="row" key={kind.id} className={styles.sheetRow} data-active={kind.id === active || undefined}>
        <span role="rowheader" className={styles.sheetName}>
          <button type="button" aria-pressed={kind.id === active} onClick={() => onPick(kind.id)}>{kind.name}</button>
        </span>
        {parcels.map((parcel) => <SheetTile key={parcel.id} parcel={parcel} kind={kind.id} postmark={postmark} world={world} />)}
      </div>)}
    </div>
  </div>;
}

function Column({ theme, parcels, design, kind, postmark, world, dropBesideMap }: {
  theme: Theme; parcels: ParcelWithEvents[]; design: CardDesign; kind: StampKind; postmark: PostmarkMode; world: boolean; dropBesideMap: boolean;
}) {
  const waiting = parcels.filter((parcel) => currentEvent(parcel.events)?.stage !== 'delivered');
  const props = { design, kind, postmark, world };
  return <div className={styles.theme} data-theme={theme}>
    <p className={styles.eyebrow}>{theme === 'light' ? 'Light' : 'Dark'}</p>
    <h3 className={styles.shelfTitle}>Opened</h3>
    <div className={styles.shelf}>
      {parcels.map((parcel) => <OpenedCard key={parcel.id} parcel={parcel} {...props} dropBesideMap={dropBesideMap} />)}
    </div>
    <h3 className={styles.shelfTitle}>Next up, in the list</h3>
    <div className={`app--deliveries ${styles.shelf}`}>
      {waiting.map((parcel) => <NextUpCard key={parcel.id} parcel={parcel} {...props} />)}
    </div>
  </div>;
}

export function StampStudy() {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const world = useWorld(true);
  const [design, setDesign] = useState<CardDesign>('today');
  const [kind, setKind] = useState<StampKind>('engraved');
  const [postmark, setPostmark] = useState<PostmarkMode>('delivered');
  const [theme, setTheme] = useState<Theme>('light');
  const [dropBesideMap, setDropBesideMap] = useState(false);
  // Demo dates count back from now; the cards only render in the browser, once ready.
  const [parcels] = useState(() => {
    const seeded = seedParcels(Date.now());
    return SAMPLES.map((label) => seeded.find((parcel) => parcel.label === label)!);
  });
  const activeDesign = DESIGNS.find((item) => item.id === design)!;
  const activeKind = KINDS.find((item) => item.id === kind)!;
  const activePostmark = POSTMARKS.find((item) => item.id === postmark)!;
  const themes = ['light', 'dark'] as const;

  return <main className={styles.study} data-ready={ready} inert={!ready}>
    <header className={styles.studyHeader}>
      <Link href="/" className={styles.brand}><Icon name="parcel" /><span>Delivery Tracker</span><span className={styles.badge}>Design study</span></Link>
    </header>
    <section className={styles.intro}>
      <p className={styles.eyebrow}>The stamp</p>
      <h1>A stamp worth keeping</h1>
      <p>Five ways to make the stamp, three postmarks, and four cards to put them on. Pick any mix; the cards are the app’s own, with the demo parcels.</p>
    </section>

    <div className={styles.picker}>
      <div className={styles.pickerRow}>
        <span className={styles.pickerLabel}>Stamp</span>
        <div role="group" aria-label="Stamp" className={styles.chips}>
          {KINDS.map((item) => <button key={item.id} type="button" aria-pressed={kind === item.id} onClick={() => setKind(item.id)}>{item.name}</button>)}
        </div>
      </div>
      <div className={styles.pickerRow}>
        <span className={styles.pickerLabel}>Postmark</span>
        <div role="group" aria-label="Postmark" className={styles.chips}>
          {POSTMARKS.map((item) => <button key={item.id} type="button" aria-pressed={postmark === item.id} onClick={() => setPostmark(item.id)}>{item.name}</button>)}
        </div>
      </div>
      <div className={`${styles.pickerRow} ${styles.themeRow}`}>
        <span className={styles.pickerLabel}>Theme</span>
        <div role="group" aria-label="Theme" className={styles.chips}>
          {themes.map((value) => <button key={value} type="button" aria-pressed={theme === value} onClick={() => setTheme(value)}>
            {value === 'light' ? 'Light' : 'Dark'}
          </button>)}
        </div>
      </div>
    </div>

    <section className={styles.sheets} data-theme={theme} aria-label="Stamp sheet">
      {ready && themes.map((value) => <Sheet key={value} theme={value} parcels={parcels} active={kind} postmark={postmark} world={world} onPick={setKind} />)}
    </section>

    <h2 className={styles.sectionTitle}>On the card</h2>
    <div className={styles.directions} role="group" aria-label="Card">
      {DESIGNS.map((item) => <button key={item.id} type="button" aria-pressed={design === item.id} onClick={() => setDesign(item.id)}>
        <span className={styles.directionNumber}>{item.number}</span>
        <strong>{item.name}</strong>
        <span>{item.summary}</span>
      </button>)}
    </div>
    <div className={styles.bench}>
      <aside className={styles.controls}>
        <div className={styles.notes}>
          <p className={styles.eyebrow}>{activeDesign.name}</p>
          <p>{activeDesign.note}</p>
          <p className={styles.eyebrow}>{activeKind.name} stamp</p>
          <p>{activeKind.note}</p>
          <p className={styles.eyebrow}>Postmark: {activePostmark.name}</p>
          <p>{activePostmark.note}</p>
        </div>
        <div className={styles.toggles}>
          <label className={styles.check}>
            <input type="checkbox" checked={dropBesideMap} onChange={(event) => setDropBesideMap(event.target.checked)} />
            <span>Leave the stamp out when the opened card shows a map</span>
          </label>
        </div>
      </aside>
      <section className={styles.columns} data-theme={theme} aria-label="Cards">
        {ready && themes.map((value) => <Column key={value} theme={value} parcels={parcels} design={design} kind={kind}
          postmark={postmark} world={world} dropBesideMap={dropBesideMap} />)}
      </section>
    </div>
  </main>;
}
