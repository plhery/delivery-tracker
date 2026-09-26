import { useCallback, useEffect, useRef, useState } from 'react';

const TURN_MS = 900;

/** Finish the current eased turn, including when the request resolves immediately. */
export function useRefreshAnimation() {
  const icon = useRef<HTMLSpanElement>(null);
  const animation = useRef<Animation | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    mounted.current = true;
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const reduce = () => { if (motion?.matches) animation.current?.cancel(); };
    motion?.addEventListener('change', reduce);
    return () => {
      mounted.current = false;
      animation.current?.cancel();
      motion?.removeEventListener('change', reduce);
    };
  }, []);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    const spin = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? icon.current?.animate?.(
        [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
        { id: 'refresh-turn', duration: TURN_MS, iterations: Infinity, easing: 'cubic-bezier(.4, 0, .2, 1)' },
      ) : undefined;
    animation.current = spin ?? null;
    // Attach before awaiting the request: unmounting can cancel the animation first.
    const finished = spin?.finished.catch(() => undefined);
    try {
      return await action();
    } finally {
      if (spin && spin.playState !== 'idle') {
        spin.effect?.updateTiming({ iterations: Math.max(1, Math.ceil(Number(spin.currentTime ?? 0) / TURN_MS)) });
        await finished;
        spin.cancel();
      }
      animation.current = null;
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  return { icon, busy, run };
}
