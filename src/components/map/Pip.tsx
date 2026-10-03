import type { CSSProperties } from 'react';
import { PARCEL, flapPoints } from '../Icon';
import styles from './map.module.css';
import { EAGER_LIFT, PIP_FRAME, type PipMood, type PipSide } from './pipGeometry';

// Where he stands and what he covers is in `pipGeometry.ts`, which needs neither React nor a style sheet.
export * from './pipGeometry';

// The card's ink mixed toward its surface, as custom properties set where Pip is placed.
const tone = (name: string): CSSProperties => ({ fill: `var(--pip-${name})` });
const EYES = [26.25, 69.75];
const EYE_Y = 33;
const TWINKLES = ['ink', 'glint', 'ink', 'glint-deep', 'glint', 'ink'];

/** The card's ink, as a stroke. */
const line = { stroke: 'var(--pip-ink)' };
const deepLine = { stroke: 'var(--pip-deep)' };

function Eyes({ rx, ry, pupil, look }: { rx: number; ry: number; pupil: number; look: readonly [number, number] }) {
  return EYES.map((x) => <g key={x}>
    <ellipse cx={x} cy={EYE_Y} rx={rx} ry={ry} style={tone('paper')} />
    <circle cx={x + look[0] * 10.5} cy={EYE_Y + look[1] * 10.5} r={pupil} style={tone('deep')} />
    <circle cx={x + look[0] * 10.5 - 2.7} cy={EYE_Y + look[1] * 10.5 - 3} r="2.4" style={tone('paper')} />
  </g>);
}

function Blush() {
  return EYES.map((x) => <ellipse key={x} cx={x - 1} cy="55.5" rx="9.75" ry="4.8" style={tone('blush')} opacity=".55" />);
}

function Face({ mood, side, below }: { mood: PipMood; side: PipSide; below: boolean }) {
  // In these moods he watches the dot: sideways, or straight up or down when he stands below or above it.
  const toward = (y: number): readonly [number, number] => side ? [.44 * side, y] : [0, below ? -.45 : .3];
  return <g transform={PARCEL.facePlane}>
    {mood === 'look' && <>
      <Eyes rx={15} ry={17.25} pupil={8.1} look={toward(.06)} />
      <path d="M39 57Q48 67.5 57 57" style={deepLine} strokeWidth="3.6" strokeLinecap="round" />
    </>}
    {mood === 'eager' && <>
      <Eyes rx={17.25} ry={19.5} pupil={6.3} look={toward(-.12)} />
      <Blush />
      <path d="M37.5 55.5Q48 72 58.5 55.5Z" style={{ ...tone('deep'), ...deepLine }} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M42.6 63.9Q48 60.3 53.4 63.9Q48 68.1 42.6 63.9Z" style={tone('blush')} />
    </>}
    {mood === 'wait' && <>
      <Eyes rx={15} ry={17.25} pupil={8.1} look={[-.24, -.52]} />
      <path d="M41.25 59.25H54.75" style={deepLine} strokeWidth="3.6" strokeLinecap="round" />
    </>}
    {mood === 'worry' && <>
      <Eyes rx={15} ry={17.25} pupil={8.1} look={[0, .16]} />
      <path d="M12.75 9L36.75 8.5M56.25 7L80.25 4.5" style={deepLine} strokeWidth="3.6" strokeLinecap="round" />
      <path d="M39 60Q48 55 57 60" style={deepLine} strokeWidth="3.6" strokeLinecap="round" />
    </>}
    {mood === 'joy' && <>
      <path d="M14.25 37.5Q26.25 21 38.25 37.5M57.75 37.5Q69.75 21 81.75 37.5" style={deepLine} strokeWidth="4.5" strokeLinecap="round" />
      <Blush />
      <path d="M33.75 53.25Q48 78 62.25 53.25Z" style={{ ...tone('deep'), ...deepLine }} strokeWidth="2.7" strokeLinejoin="round" />
      <path d="M41.1 66Q48 61.5 54.9 66Q48 71.4 41.1 66Z" style={tone('blush')} />
    </>}
  </g>;
}

function Flap({ name, open, fill }: { name: keyof typeof PARCEL.flaps; open: boolean; fill: string }) {
  return <polygon points={flapPoints(PARCEL.flaps[name], open)} style={{ ...tone(fill), ...line }} strokeOpacity=".24" strokeWidth=".7" />;
}

/** Pip in the card's own ink: the kraft parcel's geometry, recoloured, with a face for the stage. */
export function InkPip({ mood, side, below = false }: {
  mood: PipMood;
  side: PipSide;
  /** He stands straight below the dot, and looks up at it. */
  below?: boolean;
}) {
  const open = mood === 'joy';
  const eager = mood === 'eager';
  const tilt = eager ? -5 : mood === 'worry' ? 3 : 0;
  return <svg className={styles.pipArt} viewBox={`0 0 ${PIP_FRAME.width} ${PIP_FRAME.height}`} fill="none" aria-hidden="true">
    <ellipse cx="150" cy="286" rx={eager ? 69 : 84} ry="10" style={tone('shadow')} />
    {/* He hurries toward the dot, so his speed lines trail on the far side. */}
    {eager && <path d="M14 170H40M2 196H36M18 222H40" style={line} strokeWidth="7" strokeLinecap="round" opacity=".32"
      transform={side < 0 ? `matrix(-1 0 0 1 ${PIP_FRAME.width} 0)` : undefined} />}
    <g transform={`translate(0 ${eager ? -EAGER_LIFT : 0}) rotate(${tilt} 150 230)`}>
      <g className={styles.pipBody} data-mood={mood}>
        <path d={PARCEL.inside} style={tone('deep')} />
        {open && <Flap name="backLeft" open fill="back-left" />}
        <Flap name="backRight" open={open} fill="back-right" />
        <path d={PARCEL.left} style={tone('left')} />
        <path d={PARCEL.right} style={tone('right')} />
        <path d={PARCEL.left} style={tone('paper')} opacity=".07" />
        <path d={PARCEL.hairlines} style={line} strokeOpacity=".25" strokeWidth=".8" />
        <path d={PARCEL.edges} style={{ stroke: 'var(--pip-paper)' }} strokeWidth="1" opacity=".4" />
        {open && <Flap name="frontRight" open fill="front-right" />}
        <Flap name="frontLeft" open={open} fill="front-left" />
        {/* The open front flaps hang over the left side, so the face is drawn after them. */}
        <Face mood={mood} side={side} below={below} />
        {!open && <>
          <path d={PARCEL.tape} style={tone('tape')} />
          <path d={PARCEL.seam} style={{ stroke: 'var(--pip-seam)' }} strokeOpacity=".6" strokeWidth="1" strokeDasharray="3 3" />
        </>}
        {open && PARCEL.glints.map(({ x, y, size }, index) => <g key={index} transform={`translate(${x} ${y})`}>
          <g className={styles.pipGlint} style={{ '--twinkle': `${2.2 + index % 3 * .5}s`, '--twinkle-delay': `${(index * .37).toFixed(2)}s` } as CSSProperties}>
            <path d={PARCEL.glint} transform={`scale(${size / 2})`} style={tone(TWINKLES[index])} />
          </g>
        </g>)}
      </g>
    </g>
  </svg>;
}
