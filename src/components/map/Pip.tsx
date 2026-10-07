import { useState } from 'react';
import styles from './map.module.css';
import { PipDrawing } from './PipDrawing';
import { PIP_FRAME, type PipMood, type PipSide } from './pipGeometry';

// Where he stands and what he covers is in `pipGeometry.ts`, which needs neither React nor a style sheet.
export * from './pipGeometry';

/**
 * Pip in the card's own ink: the kraft parcel's geometry, recoloured, with a face for the stage.
 * When the parcel arrives while he is looked at, his box opens: the flaps turn on their hinges, the
 * tape lifts off, the face he had gives way to a happy one and the glints come last.
 */
export function InkPip({ mood, side, below = false }: {
  mood: PipMood;
  side: PipSide;
  /** He stands straight below the dot, and looks up at it. */
  below?: boolean;
}) {
  // Drawn open from the start, he has nothing to open: no tape to lift, and his glints are there at once.
  const [first] = useState(mood);
  const opened = mood === 'joy' && first !== 'joy';
  // The face he had fades out under the one he takes.
  const [shown, setShown] = useState(mood);
  const [before, setBefore] = useState<PipMood | null>(null);
  if (mood !== shown) {
    setBefore(shown);
    setShown(mood);
  }
  return <svg className={styles.pipArt} viewBox={`0 0 ${PIP_FRAME.width} ${PIP_FRAME.height}`} fill="none" aria-hidden="true">
    <PipDrawing mood={mood} side={side} below={below} opened={opened} before={before} onFaceShown={() => setBefore(null)} />
  </svg>;
}
