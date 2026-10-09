import type { CSSProperties, ReactNode } from 'react';
import { PipDrawing } from '../components/map/PipDrawing';
import { PIP_FRAME, type PipMood, type PipSide } from '../components/map/pipGeometry';

/**
 * The guides' pictures: one drawing per guide, with Pip in it. They hold no
 * words, so every language shares them, and they take the page's tones, so
 * they follow its light or dark appearance. The kraft itself stays kraft.
 */
const WIDTH = 640;
const HEIGHT = 300;
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** Pip's tones as the kraft parcel wears them. */
const KRAFT = {
  '--pip-ink': '#987450', '--pip-deep': '#20251E', '--pip-inside': '#806345', '--pip-paper': '#FFFDF6',
  '--pip-left': '#C9A47B', '--pip-right': '#B78F66', '--pip-back-left': '#C4A078', '--pip-back-right': '#D8B997',
  '--pip-front-left': '#DDBD96', '--pip-front-right': '#D1AE85', '--pip-tape': '#EBDDCA', '--pip-seam': '#AF9474',
  '--pip-blush': '#E9958F', '--pip-shadow': 'rgb(32 37 30 / 12%)', '--pip-glint': '#D6AE48', '--pip-glint-deep': '#C99B35',
} as CSSProperties;

/** Pip, standing with his feet on `(x, ground)`. He looks toward `side`. */
function Pip({ x, ground, width, mood, side = 0 }: { x: number; ground: number; width: number; mood: PipMood; side?: PipSide }) {
  const scale = width / PIP_FRAME.width;
  return <svg x={x - PIP_FRAME.groundX * scale} y={ground - PIP_FRAME.groundY * scale} width={width} height={PIP_FRAME.height * scale}
    viewBox={`0 0 ${PIP_FRAME.width} ${PIP_FRAME.height}`} overflow="visible" fill="none" style={KRAFT}>
    <PipDrawing mood={mood} side={side} inside="inside" />
  </svg>;
}

const ink = 'var(--ink)';
const soft = 'var(--ink-soft)';
const paper = 'var(--paper)';
const line = 'var(--line)';

/** A sheet of paper lying on the scene. */
function Sheet({ x, y, width, height, rx = 14, children }: { x: number; y: number; width: number; height: number; rx?: number; children?: ReactNode }) {
  return <g transform={`translate(${x} ${y})`}>
    <rect x="0" y="3" width={width} height={height} rx={rx} fill={ink} opacity=".07" />
    <rect width={width} height={height} rx={rx} fill={paper} />
    {children}
  </g>;
}

/** A delivery truck in a tone, 32 wide before `scale`, driving right unless `flip`. */
function Truck({ x, y, tone, scale = 2, flip = false }: { x: number; y: number; tone: string; scale?: number; flip?: boolean }) {
  return <g transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`}>
    <rect x="2" y="3" width="18" height="13" rx="1.3" fill={`var(--${tone})`} />
    <path d="M20 8h5l5 5v3H20Z" fill={`var(--${tone})`} />
    <path d="M22 9.5h2.5l3 3H22Z" fill={paper} opacity=".9" />
    <path d="M5 9h8" stroke={paper} strokeWidth="2" strokeLinecap="round" opacity=".85" />
    {[8, 25].map((cx) => <g key={cx}><circle cx={cx} cy="16.5" r="2.4" fill={ink} /><circle cx={cx} cy="16.5" r=".9" fill={paper} /></g>)}
  </g>;
}

/** A tracking number on a paper strip, its parts in tones. */
function NumberStrip({ x, y, parts, tone }: { x: number; y: number; parts: readonly (readonly [string, string])[]; tone: string }) {
  const widths = parts.map(([text]) => text.length * 10.4 + 14);
  // Each part starts where the ones before it end.
  const starts = widths.map((_, index) => 62 + widths.slice(0, index).reduce((sum, width) => sum + width + 5, 0));
  return <g transform={`translate(${x} ${y}) scale(1.18)`}>
    <Sheet x={0} y={0} width={starts.at(-1)! + widths.at(-1)! + 13} height={50} rx={16}>
      <Truck x={12} y={11} tone={tone} scale={1.35} />
      {parts.map(([text, color], index) => <g key={text}>
        <rect x={starts[index]} y="12" width={widths[index]} height="26" rx="8" fill={`var(--${color}-soft)`} />
        <text x={starts[index] + widths[index] / 2} y="30.5" textAnchor="middle" fontFamily={MONO} fontSize="15" fontWeight="650" letterSpacing=".5" fill={`var(--${color})`}>{text}</text>
      </g>)}
    </Sheet>
  </g>;
}

/** A dot on a route: passed, the parcel's place now, or still ahead. */
function Stop({ x, y, state, tone }: { x: number; y: number; state: 'done' | 'now' | 'ahead'; tone: string }) {
  if (state === 'ahead') return <circle cx={x} cy={y} r="9" fill={paper} stroke={line} strokeWidth="3" />;
  return <g>
    {state === 'now' && <circle cx={x} cy={y} r="19" fill={`var(--${tone})`} opacity=".18" />}
    <circle cx={x} cy={y} r="11" fill={`var(--${tone})`} />
    {state === 'done'
      ? <path d={`m${x - 5} ${y} 3.5 3.5 6.5-7`} stroke={paper} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      : <circle cx={x} cy={y} r="4" fill={paper} />}
  </g>;
}

function Formats() {
  return <>
    <NumberStrip x={34} y={36} tone="orange" parts={[['1Z', 'orange'], ['999AA1', 'blue'], ['01', 'green'], ['2345', 'lilac']]} />
    <NumberStrip x={58} y={120} tone="blue" parts={[['RR', 'blue'], ['12345678', 'orange'], ['5', 'green'], ['CH', 'lilac']]} />
    <NumberStrip x={34} y={204} tone="green" parts={[['LP', 'green'], ['00123456', 'ochre'], ['789', 'blue']]} />
    {/* The magnifier rests on the middle number's country. */}
    <g transform="translate(354 150)">
      <circle r="30" fill={paper} opacity=".3" />
      <circle r="30" stroke={ink} strokeWidth="5.5" />
      <path d="m23 23 22 22" stroke={ink} strokeWidth="9" strokeLinecap="round" />
    </g>
    <Pip x={520} ground={264} width={222} mood="look" side={-1} />
  </>;
}

function Statuses() {
  const stops = [[70, 196], [178, 150], [286, 196], [394, 150], [560, 150]] as const;
  return <>
    <path d="M70 196C110 196 138 150 178 150S246 196 286 196 354 150 394 150" stroke="var(--green)" strokeWidth="5" strokeLinecap="round" />
    <path d="M394 150H560" stroke={line} strokeWidth="5" strokeLinecap="round" strokeDasharray="2 12" />
    <Stop x={stops[0][0]} y={stops[0][1]} state="done" tone="green" />
    <Stop x={stops[1][0]} y={stops[1][1]} state="done" tone="green" />
    <Stop x={stops[2][0]} y={stops[2][1]} state="done" tone="green" />
    <Stop x={stops[3][0]} y={stops[3][1]} state="now" tone="green" />
    <Stop x={stops[4][0]} y={stops[4][1]} state="ahead" tone="green" />
    {/* What each stop is: a label, a depot, a flight, a van, a home. */}
    <g stroke={soft} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M56 222h28v18H56zM62 227v8m5-8v8m4-8v8m5-8v8" />
      <path d="m163 118 15-10 15 10v14h-30zM172 132v-9h12v9" />
      <path d="M286 224c1.5 0 2.4 1.8 2.4 4.5v5.4l11.1 6.6v3l-11.1-3.3v6.3l3.6 2.7v1.8l-6-1.5-6 1.5v-1.8l3.6-2.7v-6.3l-11.1 3.3v-3l11.1-6.6v-5.4c0-2.7.9-4.5 2.4-4.5Z" />
      <path d="m545 124 15-13 15 13v16h-10v-10h-10v10h-10z" />
    </g>
    <Truck x={362} y={86} tone="green" scale={2} />
    <Pip x={482} ground={268} width={176} mood="eager" side={1} />
  </>;
}

function Quiet() {
  return <>
    <path d="M60 184H190" stroke="var(--ochre)" strokeWidth="5" strokeLinecap="round" />
    <path d="M190 184H580" stroke={line} strokeWidth="5" strokeLinecap="round" strokeDasharray="2 13" />
    <Stop x={60} y={184} state="done" tone="ochre" />
    <Stop x={190} y={184} state="now" tone="ochre" />
    <Stop x={580} y={184} state="ahead" tone="ochre" />
    {/* A calendar whose days pass with nothing on them. */}
    <Sheet x={64} y={58} width={126} height={92} rx={14}>
      <rect width="126" height="26" rx="14" fill="var(--ochre)" />
      <rect y="14" width="126" height="12" fill="var(--ochre)" />
      {[0, 1, 2].flatMap((row) => [0, 1, 2, 3, 4].map((column) => {
        const passed = row * 5 + column < 8;
        return <rect key={`${row}-${column}`} x={14 + column * 21} y={36 + row * 17} width="14" height="10" rx="3"
          fill={passed ? 'var(--ochre-soft)' : 'var(--control)'} />;
      }))}
      <path d="m16 38 10 6m-10 0 10-6M37 38l10 6m-10 0 10-6M58 38l10 6m-10 0 10-6" stroke="var(--ochre)" strokeWidth="1.8" strokeLinecap="round" />
    </Sheet>
    {/* Three dots of waiting, over a parcel that has dozed off between two scans. */}
    <Sheet x={300} y={52} width={96} height={46} rx={23}>
      {[28, 48, 68].map((cx, index) => <circle key={cx} cx={cx} cy="23" r="6" fill="var(--ochre)" opacity={1 - index * .28} />)}
    </Sheet>
    <path d="M338 98l10 14 8-14z" fill={paper} />
    <Pip x={372} ground={262} width={214} mood="wait" />
    <g fill="none" stroke={soft} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M470 96h18l-18 20h18" />
      <path d="M502 66h13l-13 15h13" opacity=".7" />
    </g>
  </>;
}

function Missing() {
  return <>
    {/* A front door, its mat, and the place where the parcel should be. */}
    <rect x="70" y="36" width="150" height="212" rx="10" fill="var(--orange)" />
    <rect x="86" y="54" width="118" height="78" rx="6" fill={paper} opacity=".22" />
    <rect x="86" y="146" width="118" height="84" rx="6" fill={paper} opacity=".14" />
    <circle cx="196" cy="150" r="7" fill="var(--yellow)" />
    <rect x="124" y="92" width="42" height="9" rx="4.5" fill={ink} opacity=".5" />
    <path d="M40 248H600" stroke={line} strokeWidth="4" strokeLinecap="round" />
    <path d="M52 262h186l-14-14H66z" fill="var(--ink-soft)" opacity=".35" />
    <g transform="translate(262 150)">
      <path d="m0 40 62-31 62 31v58l-62 31-62-31z" fill={paper} opacity=".45" />
      <path d="m0 40 62-31 62 31v58l-62 31-62-31zM0 40l62 31 62-31M62 71v58" stroke={soft} strokeWidth="3" strokeLinejoin="round" strokeDasharray="7 8" />
      <path d="M49 50c0-17 26-17 26 0 0 10-13 10-13 22" stroke="var(--orange)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="62" cy="88" r="4.5" fill="var(--orange)" />
    </g>
    {/* The carrier's message says it has arrived. */}
    <Sheet x={268} y={40} width={150} height={56} rx={16}>
      <circle cx="30" cy="28" r="15" fill="var(--green-soft)" />
      <path d="m23 28 5 5 9-10" stroke="var(--green)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="56" y="18" width="74" height="8" rx="4" fill="var(--control)" />
      <rect x="56" y="32" width="48" height="8" rx="4" fill="var(--control)" />
    </Sheet>
    <Pip x={516} ground={262} width={196} mood="worry" side={-1} />
  </>;
}

function Customs() {
  return <>
    <path d="M40 248H600" stroke={line} strokeWidth="4" strokeLinecap="round" />
    {/* The booth, and the barrier across the way. */}
    <rect x="60" y="112" width="96" height="136" rx="10" fill="var(--lilac)" />
    <rect x="74" y="128" width="68" height="52" rx="6" fill={paper} opacity=".85" />
    <path d="M50 112h116l-12-24H62z" fill="var(--lilac)" opacity=".7" />
    <rect x="182" y="150" width="16" height="98" rx="5" fill={ink} opacity=".75" />
    <g transform="rotate(-6 190 160)">
      <rect x="186" y="150" width="252" height="20" rx="10" fill={paper} />
      {[0, 1, 2, 3, 4].map((stripe) => <path key={stripe} d={`M${214 + stripe * 46} 150h22l-12 20h-22z`} fill="var(--orange)" />)}
    </g>
    <circle cx="190" cy="160" r="13" fill={ink} />
    {/* The form, with its stamp. */}
    <Sheet x={246} y={34} width={132} height={84} rx={12}>
      <rect x="16" y="16" width="62" height="8" rx="4" fill="var(--control)" />
      <rect x="16" y="32" width="44" height="8" rx="4" fill="var(--control)" />
      <rect x="16" y="48" width="54" height="8" rx="4" fill="var(--control)" />
      <g transform="translate(94 50) rotate(-14)">
        <circle r="25" stroke="var(--lilac)" strokeWidth="3" />
        <circle r="19.5" stroke="var(--lilac)" strokeWidth="1.2" strokeDasharray="1.5 3" />
        <path d="m-10 1 7 7 13-15" stroke="var(--lilac)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </Sheet>
    <Pip x={512} ground={262} width={204} mood="wait" side={-1} />
  </>;
}

function FromChina() {
  return <>
    {/* Half the world between a seller's pin and a home. */}
    <path d="M40 262C150 150 490 150 600 262" fill="var(--blue)" opacity=".12" />
    <path d="M40 262C150 150 490 150 600 262" stroke="var(--blue)" strokeWidth="3" opacity=".35" />
    <path d="M112 196C200 40 440 40 528 196" stroke="var(--blue)" strokeWidth="4" strokeLinecap="round" strokeDasharray="3 12" />
    <g transform="translate(320 78) rotate(90)" fill="var(--blue)">
      <path d="M0-26c3.3 0 5.3 4 5.3 10v12l24.7 14.7v6.6L5.3 9.9v14l8 6v4L0 30.6l-13.3 3.3v-4l8-6v-14L-30 17.3v-6.6L-5.3-4v-12c0-6 2-10 5.3-10Z" />
    </g>
    <g transform="translate(112 196)">
      <path d="M0 0c-14-18-22-28-22-40a22 22 0 0 1 44 0c0 12-8 22-22 40Z" fill="var(--orange)" />
      <circle cy="-40" r="8.5" fill={paper} />
    </g>
    <g transform="translate(528 196)">
      <path d="M0 0c-14-18-22-28-22-40a22 22 0 0 1 44 0c0 12-8 22-22 40Z" fill="var(--green)" />
      <path d="m-10-39 10-9 10 9v11h-20z" fill={paper} />
    </g>
    {/* Two carriers: one hands the parcel to the other. */}
    <Truck x={176} y={206} tone="orange" scale={2.2} />
    <Truck x={464} y={206} tone="green" scale={2.2} flip />
    <Pip x={320} ground={270} width={170} mood="eager" side={1} />
  </>;
}

function FindNumber() {
  return <>
    {/* A shipping email, the number marked in it. */}
    <Sheet x={50} y={44} width={250} height={196} rx={18}>
      <circle cx="34" cy="36" r="14" fill="var(--blue-soft)" />
      <path d="m26 32 8 6 8-6m-16-1h16v11H26z" stroke="var(--blue)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <rect x="58" y="24" width="112" height="9" rx="4.5" fill="var(--control)" />
      <rect x="58" y="40" width="74" height="8" rx="4" fill="var(--control)" />
      <rect x="22" y="72" width="204" height="8" rx="4" fill="var(--control)" />
      <rect x="22" y="88" width="170" height="8" rx="4" fill="var(--control)" />
      <rect x="16" y="110" width="218" height="36" rx="11" fill="var(--yellow)" />
      <text x="125" y="134" textAnchor="middle" fontFamily={MONO} fontSize="16" fontWeight="650" letterSpacing="1" fill="var(--on-yellow)">RR123456785CH</text>
      <rect x="22" y="160" width="150" height="8" rx="4" fill="var(--control)" />
      <rect x="22" y="176" width="96" height="8" rx="4" fill="var(--control)" />
    </Sheet>
    {/* The same number, under the barcode of the label. */}
    <g transform="rotate(7 372 96)">
      <Sheet x={312} y={50} width={120} height={84} rx={10}>
        <path d="M16 16v34m4-34v34m5-34v34m3-34v34m6-34v34m3-34v34m5-34v34m4-34v34m3-34v34m6-34v34m3-34v34m5-34v34m4-34v34m3-34v34m6-34v34m4-34v34m3-34v34m5-34v34m4-34v34m3-34v34" stroke={ink} strokeWidth="2" />
        <rect x="16" y="60" width="88" height="10" rx="5" fill="var(--yellow)" />
      </Sheet>
    </g>
    <Pip x={508} ground={262} width={214} mood="look" side={-1} />
  </>;
}

function Universal() {
  const trucks = [['orange', 44, 34], ['blue', 30, 84], ['green', 44, 134], ['lilac', 30, 184], ['rose', 44, 234]] as const;
  return <>
    {trucks.map(([tone, x, y]) => <g key={tone}>
      <path d={`M${x + 70} ${y + 18}C${x + 150} ${y + 18} 190 150 268 150`} stroke={`var(--${tone})`} strokeWidth="3" strokeLinecap="round" strokeDasharray="2 9" opacity=".7" />
      <Truck x={x} y={y - 4} tone={tone} scale={1.9} />
    </g>)}
    {/* One list for all of them. */}
    <Sheet x={268} y={38} width={150} height={224} rx={24}>
      <rect x="52" y="12" width="46" height="7" rx="3.5" fill="var(--control)" />
      {['orange', 'blue', 'green', 'lilac'].map((tone, index) => <g key={tone} transform={`translate(14 ${36 + index * 46})`}>
        <rect width="122" height="38" rx="12" fill={`var(--${tone}-soft)`} />
        <circle cx="19" cy="19" r="8" fill={`var(--${tone})`} />
        <rect x="36" y="11" width="62" height="7" rx="3.5" fill={`var(--${tone})`} opacity=".55" />
        <rect x="36" y="23" width="40" height="6" rx="3" fill={`var(--${tone})`} opacity=".3" />
      </g>)}
    </Sheet>
    <Pip x={520} ground={266} width={200} mood="joy" />
  </>;
}

/** Snowflakes: where each falls, and how big; the small ones are further off. */
const SNOW = [[34, 34, 3.5], [92, 196, 2.5], [128, 22, 2.5], [226, 40, 3.5], [244, 120, 2.5], [300, 70, 3], [348, 26, 2.5],
  [392, 104, 3.5], [430, 44, 2.5], [470, 140, 2.5], [486, 18, 3], [560, 60, 3.5], [606, 112, 2.5], [612, 26, 2.5], [232, 196, 2]] as const;

function Christmas() {
  return <>
    {/* Snow is white in any light. */}
    {SNOW.map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="#FFFFFF" opacity={r > 3 ? .95 : .75} />)}
    <path d="M40 248H600" stroke={line} strokeWidth="4" strokeLinecap="round" />
    {/* December, with the last day to send circled and the days after it fading. */}
    <Sheet x={48} y={40} width={150} height={124} rx={14}>
      <rect width="150" height="28" rx="14" fill="var(--rose)" />
      <rect y="14" width="150" height="14" fill="var(--rose)" />
      {[0, 1, 2, 3].flatMap((row) => [0, 1, 2, 3, 4, 5].map((column) => {
        const day = row * 6 + column;
        return <rect key={day} x={14 + column * 21} y={40 + row * 19} width="14" height="11" rx="3"
          fill={day === 15 ? 'var(--rose)' : 'var(--control)'} opacity={day > 15 ? .45 : 1} />;
      }))}
      <circle cx="84" cy="83.5" r="12.5" stroke="var(--rose)" strokeWidth="2.6" />
    </Sheet>
    {/* The van in a hurry, a parcel tied with a ribbon on its roof. */}
    <g stroke={soft} strokeWidth="3" strokeLinecap="round" opacity=".6">
      <path d="M196 206h34M210 222h22M202 238h26" />
    </g>
    <Truck x={244} y={184} tone="green" scale={3.4} />
    <g transform="translate(262 156)">
      <rect width="44" height="36" rx="4" fill="#DDBD96" />
      <path d="M0 9h44" stroke="#C9A47B" strokeWidth="2" />
      <rect x="19" width="7" height="36" fill="var(--rose)" />
      <rect y="15" width="44" height="7" fill="var(--rose)" />
      <path d="M22.5 0c-4-9-15-10-14-3 1 5 9 4 14 3Zm0 0c4-9 15-10 14-3-1 5-9 4-14 3Z" fill="var(--rose)" />
    </g>
    <Pip x={520} ground={262} width={196} mood="eager" side={-1} />
  </>;
}

const SCENES: Record<string, { tone: string; draw: () => ReactNode }> = {
  'tracking-number-formats': { tone: 'blue', draw: Formats },
  'tracking-statuses': { tone: 'green', draw: Statuses },
  'tracking-not-updating': { tone: 'ochre', draw: Quiet },
  'delivered-not-received': { tone: 'orange', draw: Missing },
  customs: { tone: 'lilac', draw: Customs },
  'tracking-from-china': { tone: 'blue', draw: FromChina },
  'find-tracking-number': { tone: 'ochre', draw: FindNumber },
  'universal-tracker': { tone: 'green', draw: Universal },
  'christmas-posting-dates': { tone: 'blue', draw: Christmas },
};

/** The ids that have a picture of their own. Every guide must. */
export const GUIDE_SCENES = Object.keys(SCENES);

/** A guide's picture. With a `label` it is an image to read out; without one it decorates a link that already names the guide. */
export function GuideScene({ id, label }: { id: string; label?: string }) {
  const scene = SCENES[id];
  if (!scene) return null;
  return <svg className="guide-scene" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} fill="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <rect width={WIDTH} height={HEIGHT} fill={`var(--${scene.tone}-soft)`} />
    {scene.draw()}
  </svg>;
}
