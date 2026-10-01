import { useId } from 'react';
import { currentEvent, sortEventsDesc } from '../lib/stages';
import type { ParcelWithEvents } from '../types';

const PAPER = { width: 44, height: 56, margin: 4.5 };
const PRINT = { width: PAPER.width - PAPER.margin * 2, height: PAPER.height - PAPER.margin * 2 };
const GLOBE = 11;

/**
 * A self-adhesive stamp's serpentine die cut: every edge dips into the paper in
 * even waves that meet at the corners, where each edge starts and ends at full width.
 */
export function dieCutOutline(width: number, height: number, wavelength: number, depth: number): string {
  const f = (value: number) => String(+value.toFixed(2));
  const edge = (fromX: number, fromY: number, toX: number, toY: number, inX: number, inY: number) => {
    const waves = Math.max(1, Math.round(Math.hypot(toX - fromX, toY - fromY) / wavelength));
    const steps = waves * 10;
    let d = '';
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const dip = depth * (1 - Math.cos(2 * Math.PI * waves * t)) / 2;
      d += `L${f(fromX + (toX - fromX) * t + inX * dip)} ${f(fromY + (toY - fromY) * t + inY * dip)}`;
    }
    return d;
  };
  return `M0 0${edge(0, 0, width, 0, 0, 1)}${edge(width, 0, width, height, -1, 0)}${edge(width, height, 0, height, 0, -1)}${edge(0, height, 0, 0, 1, 0)}Z`;
}

const OUTLINE = dieCutOutline(PAPER.width, PAPER.height, 3.6, 1.1);

/** The country code of the first place the parcel was scanned, which is where it was posted. */
export function stampOrigin(parcel: ParcelWithEvents): string | null {
  return sortEventsDesc(parcel.events).filter((event) => event.place).at(-1)?.place?.country ?? null;
}

/** The day and month the parcel was delivered, as a postmark shows it: 28.09. */
export function stampDeliveryDate(parcel: ParcelWithEvents): string | null {
  const current = currentEvent(parcel.events);
  if (current?.stage !== 'delivered') return null;
  const date = new Date(current.occurredAt);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The parcel's stamp: the same globe on every parcel, printed in the card's own
 * colours, with the country it was posted in. The postmark lands with the delivery.
 */
export function ParcelStamp({ parcel }: { parcel: ParcelWithEvents }) {
  const id = useId();
  const origin = stampOrigin(parcel);
  const delivered = stampDeliveryDate(parcel);
  const cx = PRINT.width / 2;
  // Without a caption the globe sits in the middle of the print.
  const cy = origin ? 20.5 : 23.5;
  // The two parallels, half way to each pole.
  const band = GLOBE / 2;
  const chord = +Math.sqrt(GLOBE * GLOBE - band * band).toFixed(2);
  return <svg className="parcel-stamp" viewBox={`0 0 ${PAPER.width} ${PAPER.height}`} aria-hidden="true">
    <defs>
      <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy=".7" stdDeviation=".8" floodColor="#000" floodOpacity=".18" />
      </filter>
    </defs>
    <path d={OUTLINE} className="parcel-stamp__paper" filter={`url(#${id})`} />
    <g transform={`translate(${PAPER.margin} ${PAPER.margin})`}>
      <rect width={PRINT.width} height={PRINT.height} className="parcel-stamp__print" />
      <circle cx={cx} cy={cy} r={GLOBE} className="parcel-stamp__globe" />
      <ellipse cx={cx} cy={cy} rx={GLOBE * .42} ry={GLOBE} className="parcel-stamp__line" />
      <path className="parcel-stamp__line" d={`M${cx} ${cy - GLOBE}V${cy + GLOBE}M${cx - GLOBE} ${cy}H${cx + GLOBE}`
        + `M${cx - chord} ${cy - band}H${cx + chord}M${cx - chord} ${cy + band}H${cx + chord}`} />
      <circle cx={cx} cy={cy} r={GLOBE} className="parcel-stamp__rim" />
      <rect x="1.7" y="1.7" width={PRINT.width - 3.4} height={PRINT.height - 3.4} className="parcel-stamp__frame" />
      {origin && <text x={cx} y={PRINT.height - 4.7} className="parcel-stamp__code">{origin}</text>}
    </g>
    {delivered && <g className="parcel-stamp__postmark" transform={`translate(${PAPER.width - 6} 36) rotate(-12)`}>
      <circle r="11.5" />
      <circle r="8.7" />
      <text y="1.8">{delivered}</text>
    </g>}
  </svg>;
}
