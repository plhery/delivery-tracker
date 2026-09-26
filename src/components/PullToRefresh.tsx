import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import './Refresh.css';

const THRESHOLD = 72;
const HOLD = 64;
const SLOP = 8;
const MIN_SPIN_MS = 900;
const SETTLE_MS = 420;
const TURN_MS = 850;
// Enough turns to outlast the longest tracking wait without restarting the spin.
const TURNS = 160;
type Phase = 'idle' | 'pulling' | 'refreshing' | 'success' | 'error' | 'settling';
type Result = 'success' | 'error' | null;
type View = { hidden: boolean; phase: Phase; armed: boolean; result: Result; status: string | null };

/** UIScrollView's rubber band: the content keeps following the finger with growing resistance. */
function rubberBand(offset: number, dimension: number) {
  return (1 - 1 / (offset * .55 / dimension + 1)) * dimension;
}

export function PullToRefresh({ children, enabled, hidden, onRefresh }: {
  children: ReactNode;
  enabled: boolean;
  hidden: boolean;
  /** Resolves true once tracking is updated; `report` replaces the label while it waits. */
  onRefresh: (report: (status: string) => void) => Promise<boolean | undefined>;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const latest = useRef({ enabled, onRefresh });
  const rest: View = { hidden, phase: 'idle', armed: false, result: null, status: null };
  const [view, setView] = useState(rest);
  useEffect(() => { latest.current = { enabled, onRefresh }; });

  useEffect(() => {
    const element = root.current, marker = indicator.current, glyph = arrow.current, layer = content.current;
    if (!element || !marker || !glyph || !layer || hidden) return;
    document.documentElement.classList.add('has-pull-refresh');
    let alive = true;
    let locked = false;
    let armed = false;
    let progress = 0;
    let spin: Animation | undefined;
    let frame = 0;
    let start: { x: number; y: number; id: number; claimed: boolean; height: number } | null = null;
    let suppressClickUntil = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (callback: () => void, ms: number) => {
      const timer = setTimeout(() => { timers.delete(timer); if (alive) callback(); }, ms);
      timers.add(timer);
    };
    // Labels and icons change a few times per gesture, so they render through
    // React; flushSync commits them in the same frame as the motion below.
    const show = (change: Partial<View>) => {
      if (alive) flushSync(() => setView((previous) => ({ ...previous, ...change })));
    };
    // Motion changes every frame, so it bypasses React: the content moves as
    // one promoted layer and only the small indicator restyles.
    const place = (distance: number, nextProgress = Math.min(1, distance / THRESHOLD)) => {
      progress = nextProgress;
      layer.style.transform = distance > 0 ? `translate3d(0, ${distance}px, 0)` : '';
      marker.style.setProperty('--pull-distance', `${distance}px`);
      marker.style.setProperty('--pull-progress', String(progress));
    };
    const report = (status: string) => {
      if (alive) setView((previous) => previous.phase === 'refreshing' ? { ...previous, status } : previous);
    };
    const settle = () => {
      locked = true;
      armed = false;
      element.removeAttribute('data-dragging');
      show({ phase: 'settling', armed: false });
      place(0, progress);
      later(() => {
        spin?.cancel();
        spin = undefined;
        place(0);
        show({ phase: 'idle', result: null, status: null });
        locked = false;
      }, SETTLE_MS);
    };
    const cancel = () => {
      if (start?.claimed) {
        suppressClickUntil = Date.now() + 500;
        settle();
      }
      start = null;
    };
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { cancel(); return; }
      if (locked || !latest.current.enabled || window.scrollY > 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest('input, textarea, select, a, [contenteditable], [role="dialog"]')) return;
      // Let nested scrolling surfaces keep their own gestures.
      for (let node = target; node !== element; node = node.parentElement!) {
        if (!node) return;
        if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) return;
      }
      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY, id: touch.identifier, claimed: false, height: window.innerHeight };
    };
    const touchMove = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1 || !latest.current.enabled) { cancel(); return; }
      const touch = event.touches[0];
      if (touch.identifier !== start.id) { cancel(); return; }
      const dy = touch.clientY - start.y;
      const dx = touch.clientX - start.x;
      if (!start.claimed) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP) return;
        if (dy <= 0 || Math.abs(dx) > dy * .8 || window.scrollY > 0 || !event.cancelable) { start = null; return; }
        start.claimed = true;
        element.setAttribute('data-dragging', '');
        show({ phase: 'pulling' });
      }
      if (!event.cancelable) { cancel(); return; }
      event.preventDefault();
      // Measured from the end of the slop, so the content never jumps when the pull begins.
      const distance = rubberBand(Math.max(0, dy - SLOP), start.height);
      place(distance);
      if ((distance >= THRESHOLD) !== armed) {
        armed = !armed;
        show({ armed });
      }
    };
    const touchEnd = () => {
      if (!start?.claimed) { start = null; return; }
      start = null;
      suppressClickUntil = Date.now() + 500;
      if (!armed || !latest.current.enabled) { settle(); return; }
      locked = true;
      armed = false;
      element.removeAttribute('data-dragging');
      show({ phase: 'refreshing', armed: false });
      place(HOLD, 1);
      // A compositor animation keeps turning while the refreshed list renders.
      // It eases out of the pulled angle, then turns at a constant speed.
      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        spin = glyph.animate?.([
          { transform: 'rotate(270deg)', easing: 'cubic-bezier(.45, 0, .75, .75)' },
          { transform: 'rotate(630deg)', offset: 1 / TURNS },
          { transform: `rotate(${270 + 360 * TURNS}deg)` },
        ], { duration: TURN_MS * TURNS });
      }
      const began = Date.now();
      const run = async () => {
        let success = false;
        try { success = (await latest.current.onRefresh(report)) === true; } catch { /* The caller presents the error. */ }
        if (!alive) return;
        later(() => {
          const result = success ? 'success' : 'error';
          show({ phase: result, result });
          later(settle, success ? 700 : 1100);
        }, Math.max(0, MIN_SPIN_MS - (Date.now() - began)));
      };
      // Request once the release motion is on screen: a refresh that resolves at
      // once re-renders the whole list, which would otherwise delay its first frame.
      frame = requestAnimationFrame(() => later(() => void run(), 0));
    };
    const click = (event: MouseEvent) => {
      if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); }
    };
    element.addEventListener('touchstart', touchStart, { passive: true });
    element.addEventListener('touchmove', touchMove, { passive: false });
    element.addEventListener('touchend', touchEnd);
    element.addEventListener('touchcancel', cancel);
    element.addEventListener('click', click, true);
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      cancelAnimationFrame(frame);
      spin?.cancel();
      element.removeAttribute('data-dragging');
      place(0);
      document.documentElement.classList.remove('has-pull-refresh');
      element.removeEventListener('touchstart', touchStart);
      element.removeEventListener('touchmove', touchMove);
      element.removeEventListener('touchend', touchEnd);
      element.removeEventListener('touchcancel', cancel);
      element.removeEventListener('click', click, true);
    };
  }, [hidden]);

  // Reset after hiding, so switching tabs cannot preserve an unfinished pull.
  if (view.hidden !== hidden) setView(rest);
  const { phase, armed, result, status } = view;
  const label = result === 'success' ? t('app.refreshComplete')
    : result === 'error' ? t('detail.checkFailed')
      : phase === 'refreshing' ? status ?? t('app.refreshing')
        : armed ? t('app.releaseToRefresh') : t('app.pullToRefresh');

  return <div ref={root} className="pull-refresh" hidden={hidden} data-phase={phase} data-armed={armed || undefined} data-result={result ?? undefined}>
    <div ref={indicator} className="pull-refresh__indicator" aria-hidden="true">
      <span className="pull-refresh__seal">
        <span className="pull-refresh__disc">
          <svg className="pull-refresh__ring" viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" pathLength="1" /></svg>
          <span ref={arrow} className="pull-refresh__arrow"><Icon name="refresh" /></span>
          <span className="pull-refresh__result"><Icon name={result === 'error' ? 'close' : 'check'} /></span>
        </span>
      </span>
      <span className="pull-refresh__label">{label}</span>
    </div>
    <span className="sr-only" aria-live="polite" aria-atomic="true">{armed || result ? label : ''}</span>
    <div ref={content} className="pull-refresh__content">{children}</div>
  </div>;
}
