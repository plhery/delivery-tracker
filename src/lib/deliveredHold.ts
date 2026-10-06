import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { throwConfetti } from './deliveredConfetti';
import { moveDeliveredCards } from './deliveredMove';
import { justDelivered } from './justDelivered';
import { isDelivered } from './stages';
import type { ParcelWithEvents } from '../types';

/** Long enough to read "Delivered" on the card and to see the postmark land on its stamp. */
export const DELIVERED_HOLD_MS = 950;
/** Pip's box, which opens with the news, is open by then: the paper comes out of it. */
const CONFETTI_AT_MS = 330;
/** After a finger lifts, long enough for its tap to have opened what it was aimed at. */
const AFTER_TOUCH_MS = 150;

/** The parcels that have just arrived, and every parcel as the list showed it before they did. */
interface Hold {
  arrivals: ReadonlySet<string>;
  shown: ReadonlyMap<string, ParcelWithEvents>;
}
const NONE: Hold = { arrivals: new Set(), shown: new Map() };

/** Whether a card can be shown moving: where it cannot, or should not, the list changes at once. */
function moves() {
  return typeof Element.prototype.animate === 'function'
    && !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}

/**
 * A parcel delivered since the list was last shown does not jump to the past deliveries.
 * Its card first turns to Delivered where it stands, then travels there. While `watching`,
 * the list is arranged from `arranged`, in which every parcel is still as it was shown;
 * `arrived` tells which cards to draw with the news, and paper is thrown from the first of
 * them. Every card stays what it is under a finger, and a list that is covered, or that shows
 * no motion, changes without any of this.
 */
export function useDeliveredHold(parcels: ParcelWithEvents[], watching: boolean, root: RefObject<HTMLElement | null>) {
  const [seen, setSeen] = useState(parcels);
  const [held, setHeld] = useState(NONE);
  let holding = held;
  if (parcels !== seen) {
    setSeen(parcels);
    const current = new Map(parcels.map((parcel) => [parcel.id, parcel]));
    // A held parcel stays in its place for as long as it is still a delivery to show.
    const arrivals = new Set([...held.arrivals].filter((id) => {
      const parcel = current.get(id);
      return parcel !== undefined && !parcel.archivedAt && isDelivered(parcel.events);
    }));
    if (watching && moves()) for (const was of justDelivered(seen, parcels)) arrivals.add(was.id);
    if (arrivals.size !== held.arrivals.size || [...arrivals].some((id) => !held.arrivals.has(id))) {
      // The whole list keeps the arrangement it had: another parcel's news must not move the arrival out of its place.
      holding = arrivals.size ? { arrivals, shown: held.arrivals.size ? held.shown : new Map(seen.map((parcel) => [parcel.id, parcel])) } : NONE;
    }
  }
  if (!watching) holding = NONE;
  if (holding !== held) setHeld(holding);

  // The parcels whose arrival has had its paper: those that arrive together share one burst.
  const celebrated = useRef<ReadonlySet<string>>(NONE.arrivals);
  useLayoutEffect(() => {
    if (!holding.arrivals.size) {
      celebrated.current = NONE.arrivals;
      return;
    }
    let timer = 0;
    let paper = 0;
    let pressing = false;
    let due = false;
    const release = () => {
      // The list does not change under a finger that is down: a tap lands on the card it was aimed at.
      if (pressing) {
        due = true;
        return;
      }
      moveDeliveredCards(root.current, [...holding.arrivals]);
      setHeld(NONE);
    };
    // A list that nobody sees keeps the card where it is until someone looks.
    const wait = () => {
      window.clearTimeout(timer);
      window.clearTimeout(paper);
      if (document.hidden) return;
      timer = window.setTimeout(release, DELIVERED_HOLD_MS);
      const fresh = [...holding.arrivals].filter((id) => !celebrated.current.has(id));
      if (fresh.length) paper = window.setTimeout(() => {
        celebrated.current = holding.arrivals;
        throwConfetti(root.current, fresh);
      }, CONFETTI_AT_MS);
    };
    const press = () => { pressing = true; };
    const lift = () => {
      pressing = false;
      if (!due) return;
      due = false;
      window.clearTimeout(timer);
      timer = window.setTimeout(release, AFTER_TOUCH_MS);
    };
    wait();
    document.addEventListener('visibilitychange', wait);
    window.addEventListener('pointerdown', press, { capture: true, passive: true });
    window.addEventListener('pointerup', lift, { capture: true, passive: true });
    window.addEventListener('pointercancel', lift, { capture: true, passive: true });
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(paper);
      document.removeEventListener('visibilitychange', wait);
      window.removeEventListener('pointerdown', press, { capture: true });
      window.removeEventListener('pointerup', lift, { capture: true });
      window.removeEventListener('pointercancel', lift, { capture: true });
    };
  }, [holding, root]);

  const arranged = useMemo(() => holding.arrivals.size ? parcels.map((parcel) => {
    // A parcel archived or brought back in the meantime is arranged as it is now.
    const was = holding.shown.get(parcel.id);
    return was && Boolean(was.archivedAt) === Boolean(parcel.archivedAt) ? was : parcel;
  }) : parcels, [parcels, holding]);
  const fresh = useMemo(() => new Map(holding.arrivals.size ? parcels.map((parcel) => [parcel.id, parcel]) : []), [parcels, holding]);
  return {
    /** The parcels as the list arranges them. */
    arranged,
    /** Whether this parcel has just been delivered and is still shown where it stood. */
    arrived: (parcel: ParcelWithEvents) => holding.arrivals.has(parcel.id),
    /** The parcel as it is now, for a card arranged as it was. */
    current: (parcel: ParcelWithEvents) => fresh.get(parcel.id) ?? parcel,
  };
}
