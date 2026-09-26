import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import './Refresh.css';

const THRESHOLD = 72;
const HOLD = 64;
const MAX_PULL = 112;
type Phase = 'idle' | 'pulling' | 'refreshing' | 'success' | 'error' | 'settling';
type Result = 'success' | 'error' | null;

export function PullToRefresh({ children, enabled, hidden, onRefresh }: {
  children: ReactNode;
  enabled: boolean;
  hidden: boolean;
  onRefresh: () => Promise<boolean | undefined>;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ enabled, onRefresh });
  const [visual, setVisual] = useState({ hidden, phase: 'idle' as Phase, distance: 0, turn: 0, result: null as Result });
  useEffect(() => { latest.current = { enabled, onRefresh }; });

  useEffect(() => {
    const element = root.current;
    if (!element || hidden) return;
    document.documentElement.classList.add('has-pull-refresh');
    let alive = true;
    let locked = false;
    let distance = 0;
    let start: { x: number; y: number; id: number; claimed: boolean } | null = null;
    let suppressClickUntil = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (callback: () => void, ms: number) => {
      const timer = setTimeout(() => { timers.delete(timer); if (alive) callback(); }, ms);
      timers.add(timer);
    };
    const paint = (phase: Phase, nextDistance: number) => {
      distance = nextDistance;
      if (alive) setVisual((previous) => ({ hidden, phase, distance,
        turn: phase === 'pulling' ? Math.min(1, distance / THRESHOLD) * 270 : previous.turn,
        result: phase === 'settling' ? previous.result : phase === 'success' || phase === 'error' ? phase : null,
      }));
    };
    const settle = () => {
      locked = true;
      paint('settling', 0);
      later(() => { locked = false; paint('idle', 0); }, 420);
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
      start = { x: touch.clientX, y: touch.clientY, id: touch.identifier, claimed: false };
    };
    const touchMove = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1 || !latest.current.enabled) { cancel(); return; }
      const touch = event.touches[0];
      if (touch.identifier !== start.id) { cancel(); return; }
      const dy = touch.clientY - start.y;
      const dx = touch.clientX - start.x;
      if (!start.claimed) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
        if (dy <= 0 || Math.abs(dx) > dy * .8 || window.scrollY > 0) { start = null; return; }
        start.claimed = true;
      }
      if (!event.cancelable) { cancel(); return; }
      event.preventDefault();
      // A soft limit gives the gesture increasing resistance without a hard stop.
      paint('pulling', MAX_PULL * (1 - Math.exp(-Math.max(0, dy) / 150)));
    };
    const touchEnd = () => {
      if (!start?.claimed) { start = null; return; }
      start = null;
      suppressClickUntil = Date.now() + 500;
      if (distance < THRESHOLD || !latest.current.enabled) { settle(); return; }
      locked = true;
      paint('refreshing', HOLD);
      const began = Date.now();
      void (async () => {
        let success = false;
        try { success = (await latest.current.onRefresh()) === true; } catch { /* The caller presents the error. */ }
        if (!alive) return;
        later(() => {
          paint(success ? 'success' : 'error', HOLD);
          later(settle, success ? 450 : 650);
        }, Math.max(0, 900 - (Date.now() - began)));
      })();
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
      document.documentElement.classList.remove('has-pull-refresh');
      element.removeEventListener('touchstart', touchStart);
      element.removeEventListener('touchmove', touchMove);
      element.removeEventListener('touchend', touchEnd);
      element.removeEventListener('touchcancel', cancel);
      element.removeEventListener('click', click, true);
    };
  }, [hidden]);

  // Reset after hiding, so switching tabs cannot preserve an unfinished pull.
  if (visual.hidden !== hidden) setVisual({ hidden, phase: 'idle', distance: 0, turn: 0, result: null });
  const { phase, distance, turn, result } = visual;
  const armed = phase === 'pulling' && distance >= THRESHOLD;
  const progress = Math.min(1, distance / THRESHOLD);
  const label = result === 'success' ? t('app.refreshComplete')
    : result === 'error' ? t('detail.checkFailed')
      : phase === 'refreshing' ? t('app.refreshing')
        : armed ? t('app.releaseToRefresh') : t('app.pullToRefresh');

  return <div ref={root} className="pull-refresh" hidden={hidden} data-phase={phase} data-armed={armed || undefined} data-result={result ?? undefined}
    style={{ '--pull-distance': `${distance}px`, '--pull-progress': progress, '--pull-turn': `${turn}deg` } as CSSProperties}>
    <div className="pull-refresh__indicator" aria-hidden="true">
      <span className="pull-refresh__seal">
        <svg className="pull-refresh__ring" viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" pathLength="1" /></svg>
        <span className="pull-refresh__arrow"><Icon name="refresh" /></span>
        <span className="pull-refresh__result"><Icon name={result === 'error' ? 'close' : 'check'} /></span>
      </span>
      <span className="pull-refresh__label">{label}</span>
    </div>
    <span className="sr-only" aria-live="polite" aria-atomic="true">{phase === 'pulling' && armed ? label : ''}</span>
    <div className="pull-refresh__content">{children}</div>
  </div>;
}
