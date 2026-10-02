import { useEffect, useState } from 'react';

/** Each scan of the story stays for three seconds. */
export const SCAN_MS = 3_000;

/**
 * Which scan of the journey is showing. The story moves on while `playing`
 * and starts over after its last scan; paused, it holds the scan it is on,
 * which gets its full three seconds again afterwards.
 */
export function useJourneyStory(scans: number, playing: boolean): number {
  const [scan, setScan] = useState(0);
  useEffect(() => {
    if (!playing || scans < 2) return;
    const timer = setInterval(() => setScan((current) => (current + 1) % scans), SCAN_MS);
    return () => clearInterval(timer);
  }, [playing, scans]);
  return scan;
}
