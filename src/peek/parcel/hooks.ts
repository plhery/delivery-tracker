import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/** The time, moved on every minute, so "2 min ago" stays true while the page is open. */
export function useNow(every = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

/** Whether the screen matches a media query. The server, and a browser that cannot tell, say it does not. */
export function useMedia(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const list = window.matchMedia?.(query);
    list?.addEventListener('change', notify);
    return () => list?.removeEventListener('change', notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(query).matches ?? false, () => false);
}

/** Whether the page has room for two columns: from this width the map stands beside the card instead of inside it. */
export function useWideLayout(): boolean {
  return useMedia('(min-width: 1100px)');
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
