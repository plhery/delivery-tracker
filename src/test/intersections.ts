import { act } from '@testing-library/react';
import { vi } from 'vitest';

/**
 * jsdom lays nothing out, so it has no IntersectionObserver. This one sees
 * what a test tells it to: `scroll(element, share)` says how much of an
 * element is on screen, to every observer watching it.
 */
interface Watch { callback: IntersectionObserverCallback; observer: IntersectionObserver; elements: Set<Element>; threshold: number }
const watches = new Set<Watch>();

class TestIntersectionObserver {
  private readonly watch: Watch;
  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.watch = { callback, observer: this as unknown as IntersectionObserver, elements: new Set(), threshold: Number(options.threshold ?? 0) };
    watches.add(this.watch);
  }
  observe(element: Element) { this.watch.elements.add(element); }
  unobserve(element: Element) { this.watch.elements.delete(element); }
  disconnect() { this.watch.elements.clear(); watches.delete(this.watch); }
  takeRecords() { return []; }
}

/** Installs the observer for a test; `vi.unstubAllGlobals()` removes it. */
export function stubIntersections(): void {
  watches.clear();
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
}

/** How many observers are watching an element. */
export function watching(element: Element): number {
  return [...watches].filter((watch) => watch.elements.has(element)).length;
}

/**
 * Tells every observer of `element` how much of it shows: 0 for none, 1 for
 * all of it. `top` is where its top edge stands, in a window 800 px high.
 */
export function scroll(element: Element, share: number, top = share > 0 ? 100 : 900): void {
  act(() => {
    for (const watch of [...watches]) {
      if (!watch.elements.has(element)) continue;
      watch.callback([{
        target: element, isIntersecting: share > 0, intersectionRatio: share,
        boundingClientRect: { top } as DOMRectReadOnly, rootBounds: { bottom: 800 } as DOMRectReadOnly,
      } as IntersectionObserverEntry], watch.observer);
    }
  });
}
