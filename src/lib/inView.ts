import { useEffect, useState, type RefObject } from 'react';

/** Whether `share` of an element is within `margin` of the screen. Without a way to tell, it is not. */
export function useInView(target: RefObject<Element | null>, margin: string, share: number, once: boolean): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = target.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const seen = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= share);
      setInView(seen);
      if (seen && once) observer.disconnect();
    }, { rootMargin: margin, threshold: share });
    observer.observe(element);
    return () => observer.disconnect();
  }, [target, margin, share, once]);
  return inView;
}

/**
 * Turns true once an element comes close to the screen, and stays true: the
 * moment to load what it shows. The first paint never waits for it.
 */
export function useNear(target: RefObject<Element | null>, margin = '600px'): boolean {
  return useInView(target, margin, 0, true);
}
