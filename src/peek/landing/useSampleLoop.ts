import { useEffect, useRef, useState } from 'react';

/**
 * The beats of one sample: the Paste chip presses and the sample lands
 * (`paste`), the carriers are asked (`finding`), one answers (`found`), and
 * the field empties again (`clearing`). Between samples the field is at `rest`.
 */
export type SamplePhase = 'rest' | 'paste' | 'finding' | 'found' | 'clearing';
export interface SampleBeat {
  /** Which sample is in the field. */
  index: number;
  phase: SamplePhase;
}

/** A new sample every four seconds. */
export const SAMPLE_PERIOD_MS = 4_000;
/** The page arrives first: the pill, the title and the field rise, Pip drops in. */
export const FIRST_SAMPLE_MS = 1_400;
/** When each beat starts within a sample's four seconds. */
export const SAMPLE_BEATS: readonly (readonly [SamplePhase, number])[] = [
  ['paste', 0], ['finding', 300], ['found', 1_200], ['clearing', 3_600],
];

/**
 * The field showing itself: `count` samples, one after another, for as long
 * as `running`. Stopping puts the field at rest at once; running again starts
 * with the sample after the one that was interrupted.
 */
export function useSampleLoop(count: number, running: boolean): SampleBeat {
  const [beat, setBeat] = useState<SampleBeat>({ index: 0, phase: 'rest' });
  const [ran, setRan] = useState(running);
  // A loop that stops leaves nothing in the field, whatever beat it was on.
  if (ran !== running) {
    setRan(running);
    if (beat.phase !== 'rest') setBeat({ index: beat.index, phase: 'rest' });
  }
  const next = useRef(0);
  useEffect(() => {
    if (!running || count < 1) return;
    let timer: ReturnType<typeof setTimeout>;
    const play = (index: number, step: number) => {
      const [phase, start] = SAMPLE_BEATS[step];
      setBeat({ index, phase });
      const last = step === SAMPLE_BEATS.length - 1;
      if (step === 0) next.current = (index + 1) % count;
      timer = setTimeout(() => {
        if (last) play(next.current, 0);
        else play(index, step + 1);
      }, (last ? SAMPLE_PERIOD_MS : SAMPLE_BEATS[step + 1][1]) - start);
    };
    timer = setTimeout(() => play(next.current % count, 0), FIRST_SAMPLE_MS);
    return () => clearTimeout(timer);
  }, [running, count]);
  return running ? beat : { index: beat.index, phase: 'rest' };
}
