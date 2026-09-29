'use client';

import { useId, type ReactNode } from 'react';
import { PostageStamp } from '../../components/Icon';
import type { StampFacts } from './facts';
import { perforatedOutline, waves } from './geometry';
import { CountryPicture, EmojiPicture, GlyphPicture, PRINT, ScenePicture } from './pictures';
import styles from './study.module.css';

export type StampKind = 'today' | 'clean' | 'engraved' | 'picture' | 'inside';
export type PostmarkMode = 'off' | 'delivered' | 'always';

const PAPER = { width: 44, height: 56, pitch: 6.2, radius: 1.8, margin: 4.5 };
const OUTLINE = perforatedOutline(PAPER.width, PAPER.height, PAPER.pitch, PAPER.radius);

export function Stamp({ kind, facts, postmark, world }: { kind: StampKind; facts: StampFacts; postmark: PostmarkMode; world: boolean }) {
  if (kind === 'today') return <PostageStamp icon={facts.icon} />;
  return <PaperStamp kind={kind} facts={facts} postmark={postmark} world={world} />;
}

/** What a stamp shows inside its frame; also printed straight onto the stamp-shaped card. */
export function StampPicture({ kind, facts, world }: { kind: Exclude<StampKind, 'today'>; facts: StampFacts; world: boolean }) {
  if (kind === 'engraved') {
    return <CountryPicture origin={facts.origin} name={facts.originName} fallback={facts.place} icon={facts.icon} km={facts.km} ready={world} />;
  }
  if (kind === 'picture') return <ScenePicture stage={facts.stage} />;
  if (kind === 'inside') return <EmojiPicture emoji={facts.emoji} fallback={facts.icon} />;
  return <GlyphPicture icon={facts.icon} />;
}

function PaperStamp({ kind, facts, postmark, world }: { kind: Exclude<StampKind, 'today'>; facts: StampFacts; postmark: PostmarkMode; world: boolean }) {
  const id = useId();
  const framed = kind === 'clean' || kind === 'inside';
  let cancel: ReactNode = null;
  if (postmark === 'always') cancel = <MachineCancel facts={facts} />;
  else if (postmark === 'delivered' && facts.delivered) cancel = <CornerPostmark facts={facts} />;
  return <svg className={styles.stamp} data-mark={kind} viewBox={`0 0 ${PAPER.width} ${PAPER.height}`} aria-hidden="true">
    <defs>
      <filter id={`${id}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy=".7" stdDeviation=".8" floodColor="#000" floodOpacity=".18" />
      </filter>
      <clipPath id={`${id}-print`}><rect width={PRINT.width} height={PRINT.height} /></clipPath>
    </defs>
    <path d={OUTLINE} className={styles.paper} filter={`url(#${id}-shadow)`} />
    <g transform={`translate(${PAPER.margin} ${PAPER.margin})`}>
      <rect width={PRINT.width} height={PRINT.height} className={styles.print} />
      <g clipPath={`url(#${id}-print)`}><StampPicture kind={kind} facts={facts} world={world} /></g>
      {framed && <rect x="1.7" y="1.7" width={PRINT.width - 3.4} height={PRINT.height - 3.4} className={styles.frame} />}
      {framed && facts.origin && <text x={PRINT.width / 2} y={PRINT.height - 4.4} className={styles.code}>{facts.origin}</text>}
    </g>
    {cancel}
  </svg>;
}

/** A dated ring on the corner, once the parcel has arrived. */
function CornerPostmark({ facts }: { facts: StampFacts }) {
  return <g className={styles.cancel} transform={`translate(${PAPER.width - 1} 31) rotate(-12)`}>
    <circle r="11.5" />
    <circle r="8.7" className={styles.cancelThin} />
    <text y="1.8" className={styles.cancelDate}>{facts.dayMonth}</text>
  </g>;
}

/** A sorting machine's cancel: the dated ring, then waves that run on past the card's edge. */
function MachineCancel({ facts }: { facts: StampFacts }) {
  const [x, y] = [3, 42];
  return <g className={styles.cancel}>
    <circle cx={x} cy={y} r="11.2" />
    <circle cx={x} cy={y} r="8.6" className={styles.cancelThin} />
    <text x={x} y={y + 1.3} className={styles.cancelDate}>{facts.dayMonth}</text>
    <path d={waves(x + 12.6, 140, [y - 4.8, y - 1.6, y + 1.6, y + 4.8])} className={styles.waves} />
  </g>;
}

/** A size at which capitals run no longer than `length` along a ring, down to a floor. */
function fitRing(text: string, length: number): number {
  const perLetter = length / Math.max(1, text.length);
  return Math.max(4.6, Math.min(6.6, (perLetter - .9) / .68));
}

/** A post office's round date stamp: the town, the country, the date and the time. */
export function RoundPostmark({ facts }: { facts: StampFacts }) {
  const id = useId();
  return <svg className={styles.roundPostmark} viewBox="0 0 60 60" aria-hidden="true">
    <defs>
      <path id={`${id}-top`} d="M8.7 30A21.3 21.3 0 0 1 51.3 30" />
      <path id={`${id}-bottom`} d="M5 30A25 25 0 0 0 55 30" />
    </defs>
    <circle cx="30" cy="30" r="28" className={styles.ring} />
    <circle cx="30" cy="30" r="19" className={styles.ringThin} />
    <text className={styles.ringText} style={{ fontSize: fitRing(facts.place, 52) }}>
      <textPath href={`#${id}-top`} startOffset="50%">{facts.place}</textPath>
    </text>
    <text className={styles.ringText} style={{ fontSize: fitRing(facts.country, 54) }}>
      <textPath href={`#${id}-bottom`} startOffset="50%">{facts.country || '✶'}</textPath>
    </text>
    <path d="M12.4 24.6H47.6M12.4 35.4H47.6" className={styles.ringThin} />
    <text x="30" y="32.8" className={styles.ringDate}>{facts.date}</text>
    <text x="30" y="43.2" className={styles.ringTime}>{facts.time}</text>
  </svg>;
}
