'use client';

import { geoAzimuthalEqualArea, geoCentroid, geoDistance, geoGraticule, geoOrthographic, geoPath } from 'd3-geo';
import type { MultiPolygon } from 'geojson';
import { useMemo } from 'react';
import { geography } from '../../components/map/geography';
import { flag } from '../../components/map/route';
import type { StampFacts } from './facts';
import styles from './study.module.css';

/** Motifs are drawn in the stamp's printed area, 35 wide and 47 tall, around a centre line `cy`. */
export const PRINT = { width: 35, height: 47 };
const CX = PRINT.width / 2;

export type MotifId = 'globe' | 'posthorn' | 'plane' | 'compass' | 'alps' | 'homeGlobe' | 'country' | 'flag' | 'letters';

export const MOTIFS: readonly { id: MotifId; name: string; group: 'same' | 'country'; note: string }[] = [
  { id: 'globe', name: 'Globe', group: 'same', note: 'A plain globe on every parcel: it says “post from anywhere” and never needs explaining.' },
  { id: 'posthorn', name: 'Post horn', group: 'same', note: 'The horn post coaches blew on arrival, still the sign of the post across Europe.' },
  { id: 'plane', name: 'Paper plane', group: 'same', note: 'Something sent on its way, with its trail behind it.' },
  { id: 'compass', name: 'Compass', group: 'same', note: 'A compass rose, for a parcel finding its way.' },
  { id: 'alps', name: 'Alps', group: 'same', note: 'A mountain for the Swiss app it is, the way Swiss stamps show the Alps.' },
  { id: 'homeGlobe', name: 'Globe, turned', group: 'country', note: 'The same globe, turned to face the country the parcel was posted in, with that country inked in.' },
  { id: 'country', name: 'Country', group: 'country', note: 'The outline of the country the parcel was posted in.' },
  { id: 'flag', name: 'Flag', group: 'country', note: 'The flag of the country the parcel was posted in.' },
  { id: 'letters', name: 'Letters', group: 'country', note: 'The country’s code set large, like the numerals of everyday stamps.' },
];

export function Motif({ id, facts, world, cy }: { id: MotifId; facts: StampFacts; world: boolean; cy: number }) {
  // Before any scan has a place, the country motifs fall back to the plain globe.
  const known = facts.origin !== '';
  switch (id) {
    case 'posthorn': return <Posthorn cy={cy} />;
    case 'plane': return <Plane cy={cy} />;
    case 'compass': return <Compass cy={cy} />;
    case 'alps': return <Alps cy={cy} />;
    case 'homeGlobe': return known && world ? <TurnedGlobe origin={facts.origin} cy={cy} /> : <Globe cy={cy} />;
    case 'country': return known && world ? <Country origin={facts.origin} cy={cy} /> : <Globe cy={cy} />;
    case 'flag': return known ? <text x={CX} y={cy + .6} className={styles.flag}>{flag(facts.origin)}</text> : <Globe cy={cy} />;
    case 'letters': return known ? <Letters code={facts.origin} cy={cy} /> : <Globe cy={cy} />;
    default: return <Globe cy={cy} />;
  }
}

const s = styles;

function Globe({ cy, r = 11 }: { cy: number; r?: number }) {
  const half = (dy: number) => Math.sqrt(r * r - dy * dy);
  const band = r * .5;
  return <>
    <circle cx={CX} cy={cy} r={r} className={s.body} />
    <ellipse cx={CX} cy={cy} rx={r * .42} ry={r} className={s.line} />
    <path className={s.line} d={`M${CX} ${cy - r}V${cy + r}M${CX - r} ${cy}H${CX + r}M${CX - half(band)} ${cy - band}H${CX + half(band)}M${CX - half(band)} ${cy + band}H${CX + half(band)}`} />
    <circle cx={CX} cy={cy} r={r} className={s.rim} />
  </>;
}

/** The land and the graticule on an orthographic globe centred on the country. */
function TurnedGlobe({ origin, cy }: { origin: string; cy: number }) {
  const paths = useMemo(() => {
    const world = geography('coarse');
    const country = world.countries.get(origin);
    if (!country) return null;
    const [longitude, latitude] = country.label ?? geoCentroid(country.shape) as [number, number];
    // A little north of the country, so it sits just below the middle like on a desk globe.
    const projection = geoOrthographic().rotate([-longitude, -latitude + 8]).translate([CX, cy]).scale(11).clipAngle(90);
    const path = geoPath(projection);
    const land: MultiPolygon = { type: 'MultiPolygon', coordinates: world.land.map((part) => part.shape) };
    return { land: path(land), country: path(country.shape), graticule: path(geoGraticule().step([30, 30])()) };
  }, [origin, cy]);
  if (!paths) return <Globe cy={cy} />;
  return <>
    <circle cx={CX} cy={cy} r="11" className={s.body} />
    <path d={paths.graticule ?? ''} className={s.faint} />
    <path d={paths.land ?? ''} className={s.land} />
    <path d={paths.country ?? ''} className={s.shape} />
    <circle cx={CX} cy={cy} r="11" className={s.rim} />
  </>;
}

/** Only the mainland: overseas parts would shrink the country to a dot. */
function mainland(shape: MultiPolygon, label: [number, number]): MultiPolygon {
  const near = shape.coordinates.filter((polygon) => geoDistance(geoCentroid({ type: 'Polygon', coordinates: polygon }), label) < .2);
  return { type: 'MultiPolygon', coordinates: near.length ? near : shape.coordinates };
}

function Country({ origin, cy }: { origin: string; cy: number }) {
  const outline = useMemo(() => {
    const country = geography('fine').countries.get(origin);
    if (!country) return null;
    const label = country.label ?? geoCentroid(country.shape) as [number, number];
    const shape = mainland(country.shape, label);
    const projection = geoAzimuthalEqualArea().rotate([-label[0], -label[1]]).fitExtent([[6, cy - 11.5], [29, cy + 11.5]], shape);
    return geoPath(projection)(shape);
  }, [origin, cy]);
  if (!outline) return <Globe cy={cy} />;
  return <path d={outline} className={`${s.shape} ${s.outline}`} />;
}

function Letters({ code, cy }: { code: string; cy: number }) {
  return <>
    <path d={`M8 ${cy - 10.2}H27M8 ${cy + 9.4}H27`} className={s.line} />
    <text x={CX} y={cy + 5.6} className={s.letters}>{code}</text>
  </>;
}

function Posthorn({ cy }: { cy: number }) {
  // The tube leaves the mouthpiece, coils once and flares into a trumpet bell; the cord hangs below.
  const [x, y, r] = [13, cy - 1, 6];
  const [bx, by] = [x + r + 2.4, y + r];
  const tube = `M4.6 ${y + r}H${x}A${r} ${r} 0 1 1 ${x + r} ${y}C${x + r} ${y + 3.6} ${x + r + .8} ${by} ${bx} ${by}`;
  const bell = `M${bx - .4} ${by - .9}C${bx + 4.4} ${by - 1.1} ${bx + 7.4} ${by - 3.4} ${bx + 9.2} ${by - 7}`
    + `C${bx + 10.2} ${by - 2.4} ${bx + 10.2} ${by + 2.4} ${bx + 9.2} ${by + 7}C${bx + 7.4} ${by + 3.4} ${bx + 4.4} ${by + 1.1} ${bx - .4} ${by + .9}Z`;
  return <>
    <path className={s.lineThin} d={`M${x - 3.4} ${y + r + .8}C${x - 3.4} ${y + r + 6.4} ${x + 5.4} ${y + r + 6.4} ${x + 5.4} ${y + r + .8}`} />
    <path className={s.tube} d={tube} />
    <path className={`${s.shape} ${s.outline}`} d={bell} />
    <path className={s.shape} d={`M3.4 ${y + r - 1.5}h1.2v3h-1.2z`} />
  </>;
}

function Plane({ cy }: { cy: number }) {
  return <>
    <path className={s.trail} d={`M3.4 ${cy + 13}C6.6 ${cy + 8.4} 10 ${cy + 10.4} 12.6 ${cy + 6.2}`} />
    <path className={s.shape} d={`M6 ${cy + 3.2}L29.6 ${cy - 8.4}L21.4 ${cy + 10.4}Z`} />
    <path className={s.body} d={`M29.6 ${cy - 8.4}L16.6 ${cy + 5.2}L17.4 ${cy + 10.8}L20.1 ${cy + 7.6}Z`} />
    <path className={s.line} d={`M29.6 ${cy - 8.4}L16.6 ${cy + 5.2}L17.4 ${cy + 10.8}`} />
  </>;
}

function Compass({ cy }: { cy: number }) {
  const point = (angle: number, length: number, width: number) => {
    const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
    const tip = [CX + dx * length, cy + dy * length];
    const left = [CX - dy * width, cy + dx * width];
    const right = [CX + dy * width, cy - dx * width];
    return [`M${CX} ${cy}L${tip[0]} ${tip[1]}L${left[0]} ${left[1]}Z`, `M${CX} ${cy}L${tip[0]} ${tip[1]}L${right[0]} ${right[1]}Z`];
  };
  const quarter = Math.PI / 2;
  const main = [0, 1, 2, 3].map((index) => point(index * quarter - quarter, 11.2, 2.4));
  const minor = [0, 1, 2, 3].map((index) => point(index * quarter - quarter / 2, 6.6, 1.6));
  return <>
    <circle cx={CX} cy={cy} r="8.6" className={s.lineThin} />
    {minor.map(([dark, light], index) => <g key={`minor-${index}`}><path d={dark} className={s.shape} /><path d={light} className={s.body} /></g>)}
    {main.map(([dark, light], index) => <g key={`main-${index}`}><path d={dark} className={s.shape} /><path d={light} className={`${s.body} ${s.outline}`} /></g>)}
    <circle cx={CX} cy={cy} r=".9" className={s.body} />
  </>;
}

function Alps({ cy }: { cy: number }) {
  return <>
    <circle cx="25.4" cy={cy - 7.6} r="3" className={s.body} />
    <path className={s.body} d={`M3 ${cy + 9}L9 ${cy + 1}L12.5 ${cy + 4.4}L18.6 ${cy - 4.8}L24.6 ${cy + 3.4}L28.2 ${cy + .4}L32 ${cy + 9}Z`} />
    <path className={s.shape} d={`M5.5 ${cy + 11}L15.6 ${cy - 3.4}L18.4 ${cy - .2}L20.8 ${cy - 1.6}L29.5 ${cy + 11}Z`} />
    <path className={s.snow} d={`M13.2 ${cy}L15.6 ${cy - 3.4}L17.8 ${cy - .8}L16.9 ${cy - 1}L16 ${cy + .5}L15 ${cy - .5}L14.2 ${cy + .6}Z`} />
    <path className={s.line} d={`M3 ${cy + 11}H32`} />
  </>;
}
