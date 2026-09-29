'use client';

import { useId } from 'react';
import { Icon, PostageStamp, type IconName } from '../../components/Icon';
import styles from './study.module.css';

/**
 * A stamp's outline: straight edges bitten by round perforations at an even pitch,
 * with a hole at each corner where the rows of holes cross, as on a torn sheet.
 * Every arc bends into the paper, so each one sweeps the same way.
 */
export function perforatedOutline(width: number, height: number, pitch: number, radius: number): string {
  const across = Math.max(1, Math.round(width / pitch));
  const down = Math.max(1, Math.round(height / pitch));
  const dx = width / across;
  const dy = height / down;
  const r = radius;
  const f = (value: number) => String(+value.toFixed(2));
  const bite = (x: number, y: number) => `A${f(r)} ${f(r)} 0 0 0 ${f(x)} ${f(y)}`;
  let d = `M${f(r)} 0`;
  for (let i = 1; i < across; i++) d += `H${f(i * dx - r)}${bite(i * dx + r, 0)}`;
  d += `H${f(width - r)}${bite(width, r)}`;
  for (let j = 1; j < down; j++) d += `V${f(j * dy - r)}${bite(width, j * dy + r)}`;
  d += `V${f(height - r)}${bite(width - r, height)}`;
  for (let i = across - 1; i > 0; i--) d += `H${f(i * dx + r)}${bite(i * dx - r, height)}`;
  d += `H${f(r)}${bite(0, height - r)}`;
  for (let j = down - 1; j > 0; j--) d += `V${f(j * dy + r)}${bite(0, j * dy - r)}`;
  return `${d}V${f(r)}${bite(r, 0)}Z`;
}

/** What a mark may say: the status glyph, where the parcel set off, and where and when it was last scanned. */
export interface MarkFacts {
  icon: IconName;
  delivered: boolean;
  /** The last scan's town, or the carrier's name before any scan has a place. */
  place: string;
  /** The last scan's country, spelled out when it fits the ring. */
  country: string;
  /** The country code of the first place the parcel was scanned. */
  origin: string;
  /** The last scan's date, as a post office stamps it: 29.09.26. */
  date: string;
  /** The same date without the year. */
  dayMonth: string;
  time: string;
}

export type Direction = 'today' | 'recut' | 'postmark' | 'none';

export function Mark({ direction, facts }: { direction: Direction; facts: MarkFacts }) {
  if (direction === 'today') return <PostageStamp icon={facts.icon} />;
  if (direction === 'recut') return <RecutStamp facts={facts} />;
  if (direction === 'postmark') return <Postmark facts={facts} />;
  return null;
}

const STAMP = { width: 44, height: 56, pitch: 6.2, radius: 1.8, margin: 4.6 };
const OUTLINE = perforatedOutline(STAMP.width, STAMP.height, STAMP.pitch, STAMP.radius);

/** 01. The same idea, cut properly: round perforations, printed in the card's own ink. */
export function RecutStamp({ facts }: { facts: MarkFacts }) {
  const shadow = useId();
  const { width, height, margin } = STAMP;
  const print = { x: margin, y: margin, width: width - margin * 2, height: height - margin * 2 };
  const glyph = 20;
  return <svg className={styles.recut} data-mark="recut" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    <defs>
      <filter id={shadow} x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy=".7" stdDeviation=".8" floodColor="#000" floodOpacity=".18" />
      </filter>
    </defs>
    <path d={OUTLINE} className={styles.recutPaper} filter={`url(#${shadow})`} />
    <rect {...print} className={styles.recutPrint} />
    <rect x={print.x + 1.7} y={print.y + 1.7} width={print.width - 3.4} height={print.height - 3.4} className={styles.recutFrame} />
    <Icon name={facts.icon} x={(width - glyph) / 2} y={(height - glyph) / 2 - 2.5} width={glyph} height={glyph} className={styles.recutGlyph} />
    {facts.origin && <text x={width / 2} y={print.y + print.height - 4.4} className={styles.recutValue}>{facts.origin}</text>}
    {facts.delivered && <g className={styles.recutCancel} transform={`translate(${width - 5} ${height - 7}) rotate(-12)`}>
      <circle r="11.5" />
      <circle r="8.7" className={styles.recutCancelThin} />
      <text y="1.8">{facts.dayMonth}</text>
    </g>}
  </svg>;
}

/** A size at which capitals run no longer than `length` along a ring, down to a floor. */
function fitRing(text: string, length: number): number {
  const perLetter = length / Math.max(1, text.length);
  return Math.max(4.6, Math.min(6.6, (perLetter - .9) / .68));
}

/** 02. No paper at all: the ink a sorting office leaves, with where and when. */
export function Postmark({ facts }: { facts: MarkFacts }) {
  const id = useId();
  const top = `${id}-top`;
  const bottom = `${id}-bottom`;
  // Names shrink to fit their arc, so the town and the country never meet beside the date.
  const placeSize = fitRing(facts.place, 52);
  const countrySize = fitRing(facts.country, 54);
  return <svg className={styles.postmark} data-mark="postmark" viewBox="0 0 60 60" aria-hidden="true">
    <defs>
      <path id={top} d="M8.7 30A21.3 21.3 0 0 1 51.3 30" />
      <path id={bottom} d="M5 30A25 25 0 0 0 55 30" />
    </defs>
    <circle cx="30" cy="30" r="28" className={styles.postmarkRing} />
    <circle cx="30" cy="30" r="19" className={styles.postmarkRingThin} />
    <text className={styles.postmarkArc} style={{ fontSize: placeSize }}>
      <textPath href={`#${top}`} startOffset="50%">{facts.place}</textPath>
    </text>
    <text className={styles.postmarkArc} style={{ fontSize: countrySize }}>
      <textPath href={`#${bottom}`} startOffset="50%">{facts.country || '✶'}</textPath>
    </text>
    <path d="M12.4 24.6H47.6M12.4 35.4H47.6" className={styles.postmarkBridge} />
    <text x="30" y="32.8" className={styles.postmarkDate}>{facts.date}</text>
    <text x="30" y="43.2" className={styles.postmarkTime}>{facts.time}</text>
  </svg>;
}
