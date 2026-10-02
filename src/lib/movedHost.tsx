import { useEffect, useSyncExternalStore, type ReactNode } from 'react';

const installedModes = ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'];

/** Whether the page runs as an installed app, in its own window, rather than in a browser tab. */
export function isInstalledApp(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
    || installedModes.some((mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches);
}

/**
 * The same address on the origin the site moved to, or null when the page
 * stays where it is: in an installed app, or when there is nowhere else to go.
 */
export function movedAddress(to: string): string | null {
  let origin: string;
  try {
    const url = new URL(to);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    origin = url.origin;
  } catch { return null; }
  if (origin === window.location.origin || isInstalledApp()) return null;
  return `${origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
}

const never = () => () => undefined;

/**
 * Wraps the app on a host the site has left. Opening a page there redirects,
 * except where the service worker answers from its own copy of the app: this
 * is that copy. A browser tab follows to the same address on the new origin.
 * An installed app stays and keeps working: the new origin would open outside
 * its window, signed out, and away from the notifications it subscribed to.
 */
export function MovedHost({ to, children }: { to: string; children: ReactNode }) {
  const stays = useSyncExternalStore(never, () => movedAddress(to) === null, () => false);
  useEffect(() => {
    const address = movedAddress(to);
    if (address) window.location.replace(address);
  }, [to]);
  return stays ? children : null;
}
