import { lazy, useEffect, useState, useSyncExternalStore, type ComponentType, type LazyExoticComponent, type RefObject } from 'react';
import { useInView } from '../../lib/inView';

export { useNear } from '../../lib/inView';

const subscribeToTab = (notify: () => void) => {
  document.addEventListener('visibilitychange', notify);
  return () => document.removeEventListener('visibilitychange', notify);
};
const tabShown = () => document.visibilityState !== 'hidden';
const subscribeToMotion = (notify: () => void) => {
  const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  query?.addEventListener('change', notify);
  return () => query?.removeEventListener('change', notify);
};
const motionReduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Whether the tab is the one being looked at. A page still on the server is not. */
export function useTabShown(): boolean {
  return useSyncExternalStore(subscribeToTab, tabShown, () => false);
}

/** Whether the reader asked for less motion. The server draws the moving page; the still frame replaces it before anything loops. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToMotion, motionReduced, () => false);
}

/**
 * Whether a loop may run: its element is on screen, in a tab someone is
 * looking at. Off screen or in a background tab it is paused. `share` is how
 * much of the element has to show: any of it, unless a sliver tells nothing.
 */
export function useLive(target: RefObject<Element | null>, share = 0): boolean {
  const inView = useInView(target, '0px', share, false);
  return useTabShown() && inView;
}

/**
 * A picture whose code is fetched when `useNear` says so. If the code cannot
 * be fetched, as on a connection that drops or a page being left, its place
 * stays empty and the page around it stands.
 */
export function lazyPicture<Props>(load: () => Promise<{ default: ComponentType<Props> }>): LazyExoticComponent<ComponentType<Props>> {
  const Nothing: ComponentType<Props> = () => null;
  return lazy(() => load().catch(() => ({ default: Nothing })));
}

/**
 * For something that rises into place when it is first scrolled to: `wait`
 * while an element that started below the screen has not come into view, `go`
 * once it has. One that was in view from the start, or a reader who asked for
 * less motion, gets neither and sees it in place.
 */
export function useRise(target: RefObject<Element | null>): 'wait' | 'go' | undefined {
  const [rise, setRise] = useState<'wait' | 'go'>();
  useEffect(() => {
    const element = target.current;
    if (!element || typeof IntersectionObserver === 'undefined' || motionReduced()) return;
    let first = true;
    const observer = new IntersectionObserver((entries) => {
      const seen = entries.some((entry) => entry.isIntersecting);
      // Only what is wholly below the screen may be hidden: nothing in sight ever disappears.
      const below = entries.every((entry) => entry.boundingClientRect.top >= window.innerHeight);
      if (seen) {
        if (!first) setRise('go');
        observer.disconnect();
      } else if (first && below) setRise('wait');
      else if (first) observer.disconnect();
      first = false;
    }, { rootMargin: '0px 0px -12% 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);
  return rise;
}
