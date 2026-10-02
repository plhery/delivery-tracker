import { useEffect, useRef } from 'react';

/** How long typing rests before what was typed is read as finished. A paste needs no wait. */
export const TYPING_PAUSE_MS = 800;

/**
 * Calls `onPause` with the value once typing has rested. Half-typed input is
 * not a mistake: feedback about it waits for this pause, and every new value
 * restarts the wait.
 */
export function useTypingPause(value: string, onPause: (value: string) => void): void {
  const latest = useRef(onPause);
  useEffect(() => { latest.current = onPause; });
  useEffect(() => {
    const timer = setTimeout(() => latest.current(value), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [value]);
}
