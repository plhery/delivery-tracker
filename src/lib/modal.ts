import { useEffect, useLayoutEffect, useRef, type RefObject, type MouseEvent } from 'react';
import { expandCardIntoDialog, type CardOrigin } from './cardTransition';

/** Safari leaves clicked buttons unfocused; preserve the actual modal launcher. */
export function focusClickedButton(event: MouseEvent<HTMLElement>) {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button, summary') : null;
  if (target && !target.matches(':disabled')) target.focus({ preventScroll: true });
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

type HiddenState = { inert: boolean; ariaHidden: string | null };
const modals: Array<{ element: HTMLElement; original: HiddenState }> = [];

function hiddenState(element: HTMLElement): HiddenState {
  return { inert: element.hasAttribute('inert'), ariaHidden: element.getAttribute('aria-hidden') };
}

function restore(element: HTMLElement, state: HiddenState) {
  element.toggleAttribute('inert', state.inert);
  if (state.ariaHidden === null) element.removeAttribute('aria-hidden');
  else element.setAttribute('aria-hidden', state.ariaHidden);
}

function updateModalStack() {
  for (const entry of modals) {
    if (entry === modals.at(-1)) restore(entry.element, entry.original);
    else {
      entry.element.setAttribute('inert', '');
      entry.element.setAttribute('aria-hidden', 'true');
    }
  }
}

function focusableElements(modal: HTMLElement): HTMLElement[] {
  return Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
    if (element.tabIndex < 0 || element.matches(':disabled')) return false;
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (ancestor.hidden || ancestor.hasAttribute('inert')
        || style.display === 'none' || style.visibility === 'hidden') return false;
      if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
        const summary = ancestor.querySelector(':scope > summary');
        if (!summary?.contains(element)) return false;
      }
    }
    return true;
  });
}

let unlockBackground: (() => void) | null = null;

/** Shared modal behavior for portal-rendered dialogs. */
export function useModalDialog<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  initialFocus?: RefObject<HTMLElement | null>,
): RefObject<T | null> {
  const dialog = useRef<T>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !dialog.current) return;

    const modal = dialog.current;
    const background = document.querySelector<HTMLElement>('.app')
      ?? document.getElementById('root');
    const returnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const entry = { element: modal, original: hiddenState(modal) };
    modals.push(entry);
    (initialFocus?.current ?? modal).focus();
    if (modals.length === 1) {
      const previousOverflow = document.body.style.overflow;
      const original = background ? hiddenState(background) : null;
      background?.setAttribute('inert', '');
      background?.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = 'hidden';
      unlockBackground = () => {
        document.body.style.overflow = previousOverflow;
        if (background && original) restore(background, original);
      };
    }
    updateModalStack();

    const activeModal = () => modal.querySelector<HTMLDialogElement>('dialog[open]') ?? modal;

    const onKeyDown = (event: KeyboardEvent) => {
      if (modals.at(-1) !== entry) return;
      const active = activeModal();
      // Native modal dialogs already own focus and Escape. The fallback is
      // needed only in environments without showModal (including JSDOM).
      if (active instanceof HTMLDialogElement && typeof active.showModal === 'function') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (active instanceof HTMLDialogElement) active.dispatchEvent(new Event('cancel', { cancelable: true }));
        else closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = focusableElements(active);
      event.preventDefault();
      if (focusable.length === 0) {
        active.focus();
        return;
      }
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      const next = index < 0 ? (event.shiftKey ? focusable.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      focusable[next].focus();
    };

    const onFocus = (event: FocusEvent) => {
      if (modals.at(-1) !== entry || modal.contains(event.target as Node)) return;
      const active = activeModal();
      (focusableElements(active)[0] ?? active).focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocus);
      const wasTopmost = modals.at(-1) === entry;
      modals.splice(modals.indexOf(entry), 1);
      restore(modal, entry.original);
      updateModalStack();
      if (modals.length === 0) {
        unlockBackground?.();
        unlockBackground = null;
      }
      if (wasTopmost) {
        if (returnFocus?.isConnected && !returnFocus.closest('[inert]')) returnFocus.focus({ preventScroll: true });
        if (document.activeElement === document.body && modals.length > 0) {
          const parent = modals.at(-1)!.element;
          (focusableElements(parent)[0] ?? parent).focus();
        }
      }
    };
  }, [open, initialFocus]);

  return dialog;
}

/** Keep focus trapped until the panel has finished its short dismissal. */
export function useSheetDialog<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  initialFocus?: RefObject<HTMLElement | null>,
  origin?: CardOrigin | null,
): readonly [RefObject<T | null>, () => void] {
  const finish = useRef(onClose);
  const closing = useRef(false);
  const alive = useRef(true);
  const stopOpening = useRef<() => void>(() => {});
  useEffect(() => { finish.current = onClose; }, [onClose]);
  useEffect(() => {
    alive.current = true;
    closing.current = false;
    return () => { alive.current = false; };
  }, [open]);
  const dialog = useModalDialog<T>(open, dismiss, initialFocus);
  useLayoutEffect(() => {
    if (!open || !origin || !dialog.current) return;
    const stop = expandCardIntoDialog(dialog.current, origin);
    stopOpening.current = stop;
    return stop;
  }, [open, origin, dialog]);
  function dismiss() {
    if (closing.current) return;
    const element = dialog.current;
    if (!element?.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      finish.current();
      return;
    }
    closing.current = true;
    const visible = getComputedStyle(element);
    const from = {
      opacity: visible.opacity, transform: visible.transform, transformOrigin: visible.transformOrigin,
      borderRadius: visible.borderRadius, backgroundColor: visible.backgroundColor,
    };
    stopOpening.current();
    const rest = getComputedStyle(element);
    const isDetail = element.classList.contains('detail');
    const animation = element.animate([
      from,
      {
        opacity: 0, transform: isDetail ? 'translateX(24px)' : 'translateY(28px)',
        transformOrigin: from.transformOrigin, borderRadius: rest.borderRadius, backgroundColor: rest.backgroundColor,
      },
    ], { duration: 160, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    element.closest('.sheet-backdrop')?.animate([
      { backgroundColor: 'rgba(15,22,15,.28)' },
      { backgroundColor: 'rgba(15,22,15,0)' },
    ], { duration: 160, fill: 'forwards' });
    void animation.finished.catch(() => undefined).then(() => {
      if (alive.current) finish.current();
    });
  }
  return [dialog, dismiss] as const;
}
