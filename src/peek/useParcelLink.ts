import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ParcelLinkError, readParcelLink, type ParcelLinkView } from './links';
import { forgetRecent, recentFor, rememberParcel, useRecents } from './recents';
import { linkNameFromHash } from './route';

/** Until the first check lands the page asks again after 2 s, then ever more slowly up to 10 s. */
const FIRST_CHECK_MS = 2_000;
const FIRST_CHECK_MAX_MS = 10_000;
/** Afterwards, while the tab is visible. */
const LIVE_MS = 30_000;

/** A lookup answers before the carrier was asked: its first check has landed once the parcel is no longer waiting for one. */
export function firstCheckLanded(view: ParcelLinkView): boolean {
  return view.parcel.syncStatus !== 'pending' && view.parcel.syncStatus !== 'syncing';
}

export interface ParcelLinkState {
  /** `loading` until there is something to show; `unavailable` once the link leads nowhere. */
  status: 'loading' | 'ready' | 'unavailable';
  /** The newest answer, or the device's last one while a first answer is on its way or cannot come. */
  view: ParcelLinkView | null;
  /** The name this device has for the parcel, or the one the link carries. */
  name: string | null;
  /** Why the newest read failed; the view then is the last one that worked. */
  trouble: ParcelLinkError | null;
  /** The carrier has not been asked yet: the first check is still to land. */
  checking: boolean;
  /** The page is reading on its own. A hidden tab stops, and catches up when it is shown again. */
  live: boolean;
  /** A manual check is running. */
  refreshing: boolean;
  /** Checks now. In the device demo this also moves the parcel's story one step on. */
  refresh(): Promise<void>;
}

const never = () => () => undefined;
function onVisibilityChange(notify: () => void) {
  document.addEventListener('visibilitychange', notify);
  return () => document.removeEventListener('visibilitychange', notify);
}

/**
 * Follows one parcel link: reads it, keeps reading while the tab is visible,
 * and saves every answer to this device's parcels. One link per mount: give
 * the component a `key` when the link can change.
 */
export function useParcelLink(linkId: string, initial?: ParcelLinkView): ParcelLinkState {
  const recent = useRecents().find((candidate) => candidate.id === linkId);
  // The name in the address is read once, when the link is opened.
  const hash = useSyncExternalStore(never, () => window.location.hash, () => '');
  const linkName = useMemo(() => linkNameFromHash(hash), [hash]);
  const [answer, setAnswer] = useState<{ view: ParcelLinkView | null; gone: boolean; trouble: ParcelLinkError | null }>(
    { view: initial ?? null, gone: false, trouble: null },
  );
  const visible = useSyncExternalStore(onVisibilityChange, () => !document.hidden, () => true);
  const [refreshing, setRefreshing] = useState(false);
  const reader = useRef<(advance: boolean) => Promise<void>>(async () => undefined);
  const first = useRef(initial);

  useEffect(() => {
    let disposed = false;
    let gone = false;
    let landed = first.current ? firstCheckLanded(first.current) : false;
    let waits = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;

    const cadence = () => landed ? LIVE_MS : Math.min(FIRST_CHECK_MAX_MS, FIRST_CHECK_MS * 1.5 ** waits++);
    const schedule = (delay: number) => {
      clearTimeout(timer);
      if (!disposed && !gone && !document.hidden) timer = setTimeout(() => void read(false), delay);
    };

    async function read(advance: boolean) {
      clearTimeout(timer);
      controller?.abort();
      const current = controller = new AbortController();
      try {
        const result = await readParcelLink(linkId, { key: recentFor(linkId)?.key, signal: current.signal, advance });
        if (disposed || current.signal.aborted) return;
        if (result === 'unavailable') {
          // Nothing is left to follow, on the server or here.
          gone = true;
          forgetRecent(linkId);
          setAnswer({ view: null, gone: true, trouble: null });
          return;
        }
        landed = firstCheckLanded(result);
        rememberParcel({ id: linkId, view: result, suggestedName: linkNameFromHash(window.location.hash) });
        setAnswer({ view: result, gone: false, trouble: null });
        schedule(cadence());
      } catch (error) {
        if (disposed || current.signal.aborted) return;
        const trouble = error instanceof ParcelLinkError ? error : new ParcelLinkError('server', { cause: error });
        setAnswer((previous) => ({ ...previous, trouble }));
        schedule(Math.max(cadence(), (trouble.retryAfterSeconds ?? 0) * 1_000));
      }
    }
    reader.current = read;

    const onVisibility = () => {
      if (document.hidden) clearTimeout(timer);
      else if (!gone) void read(false);
    };
    const onOnline = () => { if (!gone && !document.hidden) void read(false); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    // An answer that just came with the lookup waits for its first check; any other opening reads at once, hidden or not.
    if (first.current) schedule(cadence());
    else void read(false);

    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [linkId]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await reader.current(true); } finally { setRefreshing(false); }
  }, []);

  const view = answer.view ?? (answer.gone ? null : recent?.snapshot ?? null);
  return {
    status: answer.gone ? 'unavailable' : view ? 'ready' : 'loading',
    view,
    name: recent?.name ?? (answer.gone ? null : linkName),
    trouble: answer.trouble,
    checking: !!view && !firstCheckLanded(view),
    live: visible && !answer.gone,
    refreshing,
    refresh,
  };
}
