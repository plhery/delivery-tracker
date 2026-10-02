import { useEffect, useState, useSyncExternalStore } from 'react';

/** The time, moved on every minute, so "2 min ago" stays true while the page is open. */
export function useNow(every = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

/** The width from which the map stands beside the card instead of inside it. */
const WIDE = '(min-width: 1100px)';

function subscribeToWidth(notify: () => void) {
  const query = window.matchMedia?.(WIDE);
  query?.addEventListener('change', notify);
  return () => query?.removeEventListener('change', notify);
}

/** Whether the page has room for two columns. The server and a narrow screen draw one. */
export function useWideLayout(): boolean {
  return useSyncExternalStore(subscribeToWidth, () => window.matchMedia?.(WIDE).matches ?? false, () => false);
}

function subscribeToConnection(notify: () => void) {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
}

/** Whether the browser says it has no connection. */
export function useOffline(): boolean {
  return useSyncExternalStore(subscribeToConnection, () => navigator.onLine === false, () => false);
}

/**
 * The tab's title while the page is open. When the page closes the tab is
 * `after`: the title the page was loaded with was the parcel's, not the app's.
 */
export function useTabTitle(title: string, after: string): void {
  useEffect(() => { document.title = title; }, [title]);
  useEffect(() => () => { document.title = after; }, [after]);
}
