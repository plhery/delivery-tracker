'use client';

import { useId } from 'react';
import { PostageStamp } from '../../components/Icon';
import type { StampFacts } from './facts';
import { dieCutOutline, perforatedOutline, waves } from './geometry';
import { Motif, PRINT, type MotifId } from './motifs';
import styles from './study.module.css';

export type Edge = 'perforated' | 'diecut';
export type PrintStyle = 'tinted' | 'engraved' | 'ink' | 'paper';
export type Caption = 'none' | 'code' | 'name';
export type PostmarkStyle = 'ring' | 'town' | 'waves';

export interface StampDesign {
  motif: MotifId | 'today';
  edge: Edge;
  print: PrintStyle;
  caption: Caption;
  postmark: PostmarkStyle;
}

const PAPER = { width: 44, height: 56, margin: 4.5 };
const OUTLINES: Record<Edge, string> = {
  perforated: perforatedOutline(PAPER.width, PAPER.height, 6.2, 1.8),
  diecut: dieCutOutline(PAPER.width, PAPER.height, 3.6, 1.1),
};

let hatch = '';
for (let y = 2.3; y < PRINT.height - 1.7; y += 1.15) hatch += `M1.7 ${y.toFixed(2)}H${PRINT.width - 1.7}`;

/** The stamp as it ships, or a paper stamp made to `design`. The postmark lands only once the parcel is delivered. */
export function Stamp({ design, facts, world }: { design: StampDesign; facts: StampFacts; world: boolean }) {
  if (design.motif === 'today') return <PostageStamp icon={facts.icon} />;
  return <PaperStamp design={design} motif={design.motif} facts={facts} world={world} />;
}

/** The printed part of a stamp: its ground, the motif, the frame and the caption. */
export function StampPrint({ design, motif, facts, world, clip }: { design: StampDesign; motif: MotifId; facts: StampFacts; world: boolean; clip: string }) {
  // The letters motif already sets the code large, so its caption can only be the name.
  const code = design.caption === 'code' && motif !== 'letters' ? facts.origin : '';
  const caption = design.caption === 'name' ? facts.originName : code;
  const captionSize = Math.max(3, Math.min(5.2, 26 / Math.max(1, caption.length * .7)));
  const cy = caption ? 20.5 : 23.5;
  return <>
    <rect width={PRINT.width} height={PRINT.height} className={styles.printGround} />
    {design.print === 'engraved' && <path d={hatch} className={styles.hatch} />}
    <g clipPath={`url(#${clip})`}><Motif id={motif} facts={facts} world={world} cy={cy} /></g>
    <rect x="1.7" y="1.7" width={PRINT.width - 3.4} height={PRINT.height - 3.4} className={styles.frame} />
    {caption && <text x={PRINT.width / 2} y={PRINT.height - 4.7} className={styles.caption} style={{ fontSize: captionSize }}>{caption}</text>}
  </>;
}

function PaperStamp({ design, motif, facts, world }: { design: StampDesign; motif: MotifId; facts: StampFacts; world: boolean }) {
  const id = useId();
  return <svg className={styles.stamp} data-mark={motif} data-print={design.print} viewBox={`0 0 ${PAPER.width} ${PAPER.height}`} aria-hidden="true">
    <defs>
      <filter id={`${id}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy=".7" stdDeviation=".8" floodColor="#000" floodOpacity=".18" />
      </filter>
      <clipPath id={`${id}-print`}><rect width={PRINT.width} height={PRINT.height} /></clipPath>
    </defs>
    <path d={OUTLINES[design.edge]} className={styles.paper} filter={`url(#${id}-shadow)`} />
    <g transform={`translate(${PAPER.margin} ${PAPER.margin})`}>
      <StampPrint design={design} motif={motif} facts={facts} world={world} clip={`${id}-print`} />
    </g>
    {facts.delivered && <DeliveryPostmark style={design.postmark} facts={facts} />}
  </svg>;
}

function DeliveryPostmark({ style, facts }: { style: PostmarkStyle; facts: StampFacts }) {
  if (style === 'town') return <RoundPostmark facts={facts} x={PAPER.width - 20} y={9} size={30} />;
  if (style === 'waves') {
    const [x, y] = [3, 42];
    return <g className={styles.cancel}>
      <circle cx={x} cy={y} r="11.2" />
      <circle cx={x} cy={y} r="8.6" className={styles.cancelThin} />
      <text x={x} y={y + 1.3} className={styles.cancelDate}>{facts.dayMonth}</text>
      <path d={waves(x + 12.6, 140, [y - 4.8, y - 1.6, y + 1.6, y + 4.8])} className={styles.waves} />
    </g>;
  }
  return <g className={styles.cancel} transform={`translate(${PAPER.width - 6} 36) rotate(-12)`}>
    <circle r="11.5" />
    <circle r="8.7" className={styles.cancelThin} />
    <text y="1.8" className={styles.cancelDate}>{facts.dayMonth}</text>
  </g>;
}

/** A size at which capitals run no longer than `length` along a ring, down to a floor. */
function fitRing(text: string, length: number): number {
  const perLetter = length / Math.max(1, text.length);
  return Math.max(4.6, Math.min(6.6, (perLetter - .9) / .68));
}

/** A post office's round date stamp: the town, the country, the date and the time. */
export function RoundPostmark({ facts, x, y, size }: { facts: StampFacts; x?: number; y?: number; size?: number }) {
  const id = useId();
  return <svg className={styles.roundPostmark} x={x} y={y} width={size} height={size} viewBox="0 0 60 60" aria-hidden="true">
    <defs>
      <path id={`${id}-top`} d="M8.7 30A21.3 21.3 0 0 1 51.3 30" />
      <path id={`${id}-bottom`} d="M5 30A25 25 0 0 0 55 30" />
    </defs>
    <g transform="rotate(-12 30 30)">
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
    </g>
  </svg>;
}
