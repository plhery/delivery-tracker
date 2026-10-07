import type { CSSProperties } from 'react';
import { PARCEL, ParcelFlap } from '../Icon';
import styles from './map.module.css';
import { EAGER_LIFT, PIP_FRAME, type PipMood, type PipSide } from './pipGeometry';

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

/** A flap on its hinge, in the card's ink: it turns as the kraft parcel's does when the box opens. */
function Flap({ name, fill, rear = false, hidden = false }: { name: keyof typeof PARCEL.flaps; fill: string; rear?: boolean; hidden?: boolean }) {
  return <ParcelFlap flap={PARCEL.flaps[name]} tone={`var(--pip-${fill})`} ink="var(--pip-ink)" rear={rear} hidden={hidden} />;
}

/**
 * Pip's drawing in the frame of `PIP_FRAME`, coloured by the `--pip-*` tones around it, without an `<svg>` of
 * its own and without state: `InkPip` keeps what changes as he is watched, and a page can draw him in its own scene.
 */
export function PipDrawing({ mood, side, below = false, opened = false, before = null, inside = 'deep', onFaceShown }: {
  mood: PipMood;
  side: PipSide;
  /** He stands straight below the dot, and looks up at it. */
  below?: boolean;
  /** His box opened while he was watched: the tape is still there to lift, and the glints come late. */
  opened?: boolean;
  /** The face he had, fading out under the one he takes. */
  before?: PipMood | null;
  /** The tone of the box's inside, the deep one unless a drawing names its own. */
  inside?: string;
  /** The new face has finished appearing. */
  onFaceShown?: () => void;
}) {
  const open = mood === 'joy';
  const eager = mood === 'eager';
  const tilt = eager ? -5 : mood === 'worry' ? 3 : 0;
  return <>
    <ellipse cx="150" cy="286" rx={eager ? 69 : 84} ry="10" style={tone('shadow')} />
    {/* He hurries toward the dot, so his speed lines trail on the far side. */}
    {eager && <path d="M14 170H40M2 196H36M18 222H40" style={line} strokeWidth="7" strokeLinecap="round" opacity=".32"
      transform={side < 0 ? `matrix(-1 0 0 1 ${PIP_FRAME.width} 0)` : undefined} />}
    <g className={styles.pipStance} style={{ transform: `translateY(${eager ? -EAGER_LIFT : 0}px) rotate(${tilt}deg)` }}>
      <g className={styles.pipBody} data-mood={mood}>
        <path d={PARCEL.inside} style={tone(inside)} />
        <Flap name="backLeft" fill="back-left" rear hidden />
        <Flap name="backRight" fill="back-right" rear />
        <path d={PARCEL.left} style={tone('left')} />
        <path d={PARCEL.right} style={tone('right')} />
        <path d={PARCEL.left} style={tone('paper')} opacity=".07" />
        <path d={PARCEL.hairlines} style={line} strokeOpacity=".25" strokeWidth=".8" />
        <path d={PARCEL.edges} style={{ stroke: 'var(--pip-paper)' }} strokeWidth="1" opacity=".4" />
        {/* The face is on the side, under the front flaps: open, the left one is a brim over his eyes. */}
        {before && <g key={`was-${before}`} className={styles.pipFaceGone}><Face mood={before} side={side} below={below} /></g>}
        <g key={mood} className={before ? styles.pipFaceNew : undefined} onAnimationEnd={onFaceShown}>
          <Face mood={mood} side={side} below={below} />
        </g>
        <Flap name="frontRight" fill="front-right" hidden />
        <Flap name="frontLeft" fill="front-left" />
        {(!open || opened) && <g className={styles.pipTape}>
          <path d={PARCEL.tape} style={tone('tape')} />
          <path d={PARCEL.seam} style={{ stroke: 'var(--pip-seam)' }} strokeOpacity=".6" strokeWidth="1" strokeDasharray="3 3" />
        </g>}
        {open && <g className={styles.pipGlints} data-late={opened || undefined}>
          {PARCEL.glints.map(({ x, y, size }, index) => <g key={index} transform={`translate(${x} ${y})`}>
            <g className={styles.pipGlint} style={{ '--twinkle': `${2.2 + index % 3 * .5}s`, '--twinkle-delay': `${(index * .37).toFixed(2)}s` } as CSSProperties}>
              <path d={PARCEL.glint} transform={`scale(${size / 2})`} style={tone(TWINKLES[index])} />
            </g>
          </g>)}
        </g>}
      </g>
    </g>
  </>;
}
