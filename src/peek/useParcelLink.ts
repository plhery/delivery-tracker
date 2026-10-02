import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { parcelHasCarrierUpdate } from '../lib/parcelStatus';
import { currentEvent } from '../lib/stages';
import type { TrackingEvent } from '../types';
import { isWrappedGift, ParcelLinkError, readParcelLink, type ParcelLinkView } from './links';
import { forgetRecent, recentFor, rememberParcel, useRecents } from './recents';
import { linkWordsFromHash, type LinkWords } from './route';

/** Until the first check lands the page asks again after 2 s, then ever more slowly up to 10 s. */
const FIRST_CHECK_MS = 2_000;
const FIRST_CHECK_MAX_MS = 10_000;
/** Afterwards, while the tab is visible. */
const LIVE_MS = 30_000;
/** A tab left in the background keeps asking for a while, slowly, so its title can say a scan arrived. */
const BACKGROUND_MS = 120_000;
const BACKGROUND_FOR_MS = 30 * 60_000;

/** A lookup answers before the carrier was asked: its first check has landed once the parcel is no longer waiting for one. */
export function firstCheckLanded(view: ParcelLinkView): boolean {
  return view.parcel.syncStatus !== 'pending' && view.parcel.syncStatus !== 'syncing';
}

/** The scan an answer brings that the answer before it did not have. A first check landing is not news. */
export function newScan(before: ParcelLinkView | null, after: ParcelLinkView): TrackingEvent | null {
  if (!before || !parcelHasCarrierUpdate(before.parcel) || !parcelHasCarrierUpdate(after.parcel)) return null;
  const was = currentEvent(before.parcel.events)!;
  const now = currentEvent(after.parcel.events)!;
  return now.id !== was.id && Date.parse(now.occurredAt) >= Date.parse(was.occurredAt) ? now : null;
}

export interface ParcelLinkState {
  /** `loading` until there is something to show; `unavailable` once the link leads nowhere; `stopped` once its owner stopped sharing it. */
  status: 'loading' | 'ready' | 'unavailable' | 'stopped';
  /** The newest answer, or the device's last one while a first answer is on its way or cannot come. */
  view: ParcelLinkView | null;
  /** The name this device has for the parcel, or the one the link carries. */
  name: string | null;
  /**
   * What the link carries after its `#`: the name, a gift's note and who it is
   * from. All empty while the link shows a gift still on its way: the browser
   * has them, the reader does not see them yet.
   */
  words: LinkWords;
  /** Why the newest read failed; the view then is the last one that worked. */
  trouble: ParcelLinkError | null;
  /** The carrier has not been asked yet: the first check is still to land. */
  checking: boolean;
  /** The page is reading on its own, in a tab someone is looking at. */
  live: boolean;
  /** A manual check is running. */
  refreshing: boolean;
  /** When this device last got an answer for the parcel. */
  seenAt: string | null;
  /** The newest scan, when it arrived while the page was open or since this device last looked. */
  news: TrackingEvent | null;
  /** How many scans arrived while the tab was in the background; none once it is shown again. */
  unseen: number;
  /** The delivery estimate before the carrier changed it, as far as this device saw. */
  previousEstimate: string | null;
  /** Checks now, and says whether that brought a new scan. In the device demo this also moves the parcel's story one step on. */
  refresh(): Promise<boolean>;
  /** The news has been told. */
  dismissNews(): void;
  /** Takes an answer the page got itself, as after changing what the link shows. */
  adopt(view: ParcelLinkView): void;
}

const NO_WORDS: LinkWords = { name: null, note: null, from: null };

const never = () => () => undefined;
function onVisibilityChange(notify: () => void) {
  document.addEventListener('visibilitychange', notify);
  return () => document.removeEventListener('visibilitychange', notify);
}

/**
 * Follows one parcel link: reads it, keeps reading while the tab is visible
 * and for a while after it is hidden, and saves every answer to this device's
 * parcels. One link per mount: give the component a `key` when the link can change.
 */
export function useParcelLink(linkId: string, initial?: ParcelLinkView): ParcelLinkState {
  const recent = useRecents().find((candidate) => candidate.id === linkId);
  // The name in the address is read once, when the link is opened.
  const hash = useSyncExternalStore(never, () => window.location.hash, () => '');
  const carried = useMemo(() => linkWordsFromHash(hash), [hash]);
  const [answer, setAnswer] = useState<{ view: ParcelLinkView | null; gone: false | 'unavailable' | 'stopped'; trouble: ParcelLinkError | null }>(
    { view: initial ?? null, gone: false, trouble: null },
  );
  const [told, setTold] = useState<{ news: TrackingEvent | null; unseen: number; previousEstimate: string | null }>(
    { news: null, unseen: 0, previousEstimate: null },
  );
  const visible = useSyncExternalStore(onVisibilityChange, () => !document.hidden, () => true);
  const [refreshing, setRefreshing] = useState(false);
  const reader = useRef<(advance: boolean) => Promise<boolean>>(async () => false);
  const first = useRef(initial);
  // Nothing is left to follow: no later answer brings the link back.
  const ended = useRef(false);

  useEffect(() => {
    let disposed = false;
    let gone = false;
    let landed = first.current ? firstCheckLanded(first.current) : false;
    let waits = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let hiddenAt = document.hidden ? Date.now() : null;
    // What the reader saw last: the lookup's answer, or what this device kept from an earlier visit.
    let shown = first.current ?? recentFor(linkId)?.snapshot ?? null;

    const cadence = () => !landed ? Math.min(FIRST_CHECK_MAX_MS, FIRST_CHECK_MS * 1.5 ** waits++)
      : document.hidden ? BACKGROUND_MS : LIVE_MS;
    const schedule = (delay: number) => {
      clearTimeout(timer);
      const watching = !document.hidden || (hiddenAt !== null && Date.now() + delay - hiddenAt <= BACKGROUND_FOR_MS);
      if (!disposed && !gone && watching) timer = setTimeout(() => void read(false), delay);
    };

    async function read(advance: boolean): Promise<boolean> {
      clearTimeout(timer);
      controller?.abort();
      const current = controller = new AbortController();
      try {
        const result = await readParcelLink(linkId, { key: recentFor(linkId)?.key, signal: current.signal, advance, tellStopped: true });
        if (disposed || current.signal.aborted) return false;
        if (result === 'unavailable') {
          // Nothing is left to follow, on the server or here.
          gone = ended.current = true;
          forgetRecent(linkId);
          setAnswer({ view: null, gone: 'unavailable', trouble: null });
          return false;
        }
        landed = firstCheckLanded(result);
        const scan = newScan(shown, result);
        const earlier = shown?.parcel.expectedDelivery;
        const moved = !!earlier && !!result.parcel.expectedDelivery && earlier !== result.parcel.expectedDelivery;
        shown = result;
        // A gift on its way keeps its name to itself: the device does not learn it before the delivery.
        rememberParcel({ id: linkId, view: result, suggestedName: isWrappedGift(result) ? null : linkWordsFromHash(window.location.hash).name });
        setAnswer({ view: result, gone: false, trouble: null });
        if (scan || moved) {
          const inBackground = document.hidden;
          setTold((previous) => ({
            news: scan ?? previous.news,
            unseen: previous.unseen + (scan && inBackground ? 1 : 0),
            previousEstimate: moved ? earlier : previous.previousEstimate,
          }));
        }
        schedule(cadence());
        return !!scan;
      } catch (error) {
        if (disposed || current.signal.aborted) return false;
        if (error instanceof ParcelLinkError && error.kind === 'stopped') {
          // Its owner stopped sharing: what this device kept of it goes too.
          gone = ended.current = true;
          forgetRecent(linkId);
          setAnswer({ view: null, gone: 'stopped', trouble: null });
          return false;
        }
        const trouble = error instanceof ParcelLinkError ? error : new ParcelLinkError('server', { cause: error });
        setAnswer((previous) => ({ ...previous, trouble }));
        schedule(Math.max(cadence(), (trouble.retryAfterSeconds ?? 0) * 1_000));
        return false;
      }
    }
    reader.current = read;

    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        schedule(cadence());
        return;
      }
      hiddenAt = null;
      setTold((previous) => previous.unseen ? { ...previous, unseen: 0 } : previous);
      if (!gone) void read(false);
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
    try { return await reader.current(true); } finally { setRefreshing(false); }
  }, []);
  const dismissNews = useCallback(() => setTold((previous) => previous.news ? { ...previous, news: null } : previous), []);
  const adopt = useCallback((next: ParcelLinkView) => {
    if (ended.current) return;
    rememberParcel({ id: linkId, view: next });
    setAnswer({ view: next, gone: false, trouble: null });
  }, [linkId]);

  const view = answer.view ?? (answer.gone ? null : recent?.snapshot ?? null);
  // Until the first answer says what the link is, nothing it carries is shown: it may be a gift.
  const words = view && !isWrappedGift(view) ? carried : NO_WORDS;
  return {
    status: answer.gone || (view ? 'ready' : 'loading'),
    view,
    name: recent?.name ?? words.name,
    words,
    trouble: answer.trouble,
    checking: !!view && !firstCheckLanded(view),
    live: visible && !answer.gone,
    refreshing,
    seenAt: recent?.lastSeenAt ?? null,
    news: told.news,
    unseen: told.unseen,
    previousEstimate: told.previousEstimate,
    refresh,
    dismissNews,
    adopt,
  };
}
