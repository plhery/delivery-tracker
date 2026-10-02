import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trackAction } from '../../lib/analytics';
import { normalizeTrackingNumber } from '../../lib/carriers';
import { useTypingPause } from '../../lib/typingPause';
import { detectCarrierPublic, lookupParcel, ParcelLinkError, parcelLinkErrorKey, type ParcelLookup } from '../links';
import { useRecents } from '../recents';
import { openParcelLink } from '../route';
import {
  initialLookup,
  lookupStep,
  secondsLeft,
  survey,
  unanswered,
  type DeviceParcel,
  type LookupEvent,
  type LookupJob,
  type LookupState,
  type LookupTrouble,
  type Survey,
} from './machine';

/** How long the carriers get to answer before the door stops waiting for them. The first check asks them again. */
export const ASK_PATIENCE_MS = 4_000;
/** The recognise beat: the label prints and the carrier's colour rises before the parcel's page takes over. */
export const RECOGNISE_BEAT_MS = 250;
/** When a refusal names no delay. */
const DEFAULT_RETRY_SECONDS = 60;
/** The hand-over replaces the door; a door still standing after this takes the field back. */
const HAND_OVER_MS = 3_000;

function troubleOf(error: unknown, now: number): LookupTrouble {
  if (!(error instanceof ParcelLinkError)) return { kind: 'server' };
  if (error.kind === 'burst') return { kind: 'burst', until: now + (error.retryAfterSeconds ?? DEFAULT_RETRY_SECONDS) * 1_000 };
  if (error.kind === 'daily' || error.kind === 'offline') return { kind: error.kind };
  if (error.kind === 'validation') return { kind: 'validation', message: parcelLinkErrorKey(error) };
  return { kind: 'server' };
}

const still = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
const rest = (milliseconds: number) => new Promise<void>((resolve) => { setTimeout(resolve, milliseconds); });

export interface Lookup {
  state: LookupState;
  found: Survey;
  /** Whole seconds until the next lookup may go; 0 when nothing holds it. */
  retryIn: number;
  send(event: LookupEvent): void;
}

/**
 * Runs the front door's lookup: the state machine, and around it the three
 * things that take time: asking the carriers, the lookup itself, and the
 * countdown of a refusal. Each request is started by the event that calls for
 * it and happens once.
 */
export function useLookup(onTracked: (lookup: ParcelLookup) => void): Lookup {
  const recents = useRecents();
  const device = useMemo<DeviceParcel[]>(() => recents.flatMap(({ id, snapshot: { parcel } }) =>
    parcel.trackingNumber ? [{ id, number: normalizeTrackingNumber(parcel.trackingNumber), carrier: parcel.carrier }] : []), [recents]);
  const [state, setState] = useState(initialLookup);
  const [retryIn, setRetryIn] = useState(0);
  // The requests outlive a render: they read and move the latest state, not the one they started from.
  const live = useRef({ state, device, onTracked });
  useEffect(() => { live.current.device = device; live.current.onTracked = onTracked; });
  const asking = useRef<{ number: string; stop: () => void } | null>(null);
  const working = useRef<{ job: LookupJob; stop: () => void } | null>(null);
  const ticking = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendRef = useRef<(event: LookupEvent) => void>(() => undefined);

  const send = useCallback((event: LookupEvent) => {
    const previous = live.current.state;
    const next = lookupStep(previous, event, live.current.device);
    if (next === previous) return;
    live.current.state = next;
    setState(next);
    const dispatch = sendRef.current;

    // Ask the carriers about the number the state now wants asked, and nobody about any other.
    const ask = survey(next, live.current.device).ask;
    if (asking.current?.number !== ask) {
      asking.current?.stop();
      asking.current = null;
      if (ask) {
        const controller = new AbortController();
        const answer = (value = unanswered(ask)) => { if (!controller.signal.aborted) dispatch({ type: 'answer', answer: value }); };
        const patience = setTimeout(() => { answer(); controller.abort(); }, ASK_PATIENCE_MS);
        asking.current = { number: ask, stop: () => { clearTimeout(patience); controller.abort(); } };
        // A refusal or a failure degrades quietly: the lookup works without the answer.
        detectCarrierPublic(ask, controller.signal).then(answer, () => answer()).finally(() => clearTimeout(patience));
      }
    }

    const job = next.job;
    if (job !== working.current?.job) {
      working.current?.stop();
      working.current = null;
      if (job?.type === 'open') {
        openParcelLink(job.id);
        dispatch({ type: 'done' });
      } else if (job) {
        const controller = new AbortController();
        let handOver: ReturnType<typeof setTimeout> | undefined;
        working.current = { job, stop: () => { clearTimeout(handOver); controller.abort(); } };
        const beat = still() ? Promise.resolve() : rest(RECOGNISE_BEAT_MS);
        lookupParcel(job.input, controller.signal).then(async (lookup) => {
          await beat;
          if (controller.signal.aborted) return;
          trackAction('parcel-lookup', 'success');
          live.current.onTracked(lookup);
          handOver = setTimeout(() => dispatch({ type: 'done' }), HAND_OVER_MS);
        }, (error: unknown) => {
          if (controller.signal.aborted) return;
          trackAction('parcel-lookup', 'error');
          dispatch({ type: 'failed', trouble: troubleOf(error, Date.now()) });
        });
      }
    }

    // The countdown is the button's own text: it runs while a refusal holds lookups back.
    const trouble = next.trouble;
    if (trouble !== previous.trouble) {
      if (ticking.current) clearInterval(ticking.current);
      ticking.current = null;
      setRetryIn(secondsLeft(trouble, Date.now()));
      if (trouble?.kind === 'burst') {
        ticking.current = setInterval(() => {
          const left = secondsLeft(trouble, Date.now());
          setRetryIn(left);
          if (left <= 0) dispatch({ type: 'cooled' });
        }, 250);
      }
    }
  }, []);
  useEffect(() => { sendRef.current = send; }, [send]);

  useTypingPause(state.text, useCallback((text: string) => send({ type: 'pause', text }), [send]));

  useEffect(() => {
    const online = () => send({ type: 'online' });
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('online', online);
      asking.current?.stop();
      working.current?.stop();
      if (ticking.current) clearInterval(ticking.current);
      asking.current = working.current = ticking.current = null;
    };
  }, [send]);

  const found = useMemo(() => survey(state, device), [state, device]);
  return { state, found, retryIn, send };
}
