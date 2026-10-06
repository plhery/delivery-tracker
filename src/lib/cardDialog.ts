import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { bindCardDialog, type CardDialog, type CardOrigin } from './cardTransition';
import { useModalDialog } from './modal';

/** What ties a page to the card it opens from. */
export interface CardDialogLink {
  /** The tapped card; without one the page arrives on its own. */
  origin?: CardOrigin | null;
  /** The card closing returns to, wherever it is by then. */
  findCard: () => HTMLElement | null;
  /** The part of the page that looks like the card and takes its place. */
  anchor?: (page: HTMLElement) => HTMLElement | null;
  /** A sticky header that covers the anchor once the page has scrolled. */
  header?: (page: HTMLElement) => HTMLElement | null;
  /** The part whose words differ from the card's, where that is not the anchor itself. */
  worded?: (page: HTMLElement) => HTMLElement | null;
  /** Whether pulling the page down may close it now. */
  canPull?: () => boolean;
  /** Whether the page may close at all now; it stays while something it started is still under way. */
  canClose?: () => boolean;
}

/** A modal page that grows out of a card and goes back into it; under a finger, pulling it down closes it. */
export function useCardDialog<T extends HTMLElement>(
  onClose: () => void,
  initialFocus: RefObject<HTMLElement | null> | undefined,
  link: CardDialogLink,
): readonly [RefObject<T | null>, () => void] {
  const latest = useRef({ onClose, link });
  useEffect(() => { latest.current = { onClose, link }; });
  const bound = useRef<CardDialog | null>(null);
  const dialog = useModalDialog<T>(true, dismiss, initialFocus);
  useLayoutEffect(() => {
    const page = dialog.current;
    if (!page) return;
    const { origin } = latest.current.link;
    const card = bound.current = bindCardDialog(page, {
      origin,
      card: () => (origin?.card.isConnected ? origin.card : null) ?? latest.current.link.findCard(),
      anchor: () => latest.current.link.anchor?.(page) ?? null,
      header: () => latest.current.link.header?.(page) ?? null,
      worded: () => latest.current.link.worded?.(page) ?? null,
      canPull: () => (latest.current.link.canClose?.() ?? true) && (latest.current.link.canPull?.() ?? true),
      onClosed: () => latest.current.onClose(),
    });
    return () => {
      card.release();
      bound.current = null;
    };
  }, [dialog]);
  // The card may have been drawn anew while its page was open, and the focus then has nowhere to return to:
  // it goes to the card that stands there now.
  useEffect(() => {
    const card = () => latest.current.link.findCard();
    return () => {
      if (document.activeElement === document.body) card()?.focus({ preventScroll: true });
    };
  }, []);
  function dismiss() {
    if (latest.current.link.canClose?.() === false) return;
    if (bound.current) bound.current.close();
    else latest.current.onClose();
  }
  return [dialog, dismiss] as const;
}
