import { springAt, springSettleTime, type Spring } from './spring';

// The deliveries page and the blocks that move when a parcel leaves or returns.
const ROOT = '.deliveries-page';
const CARD = '.parcel-card-swipe';
const BLOCKS = `${CARD}, .parcel-section, .delivery-arrived`;
const GLIDE: Spring = { duration: 0.42 };

type Point = { x: number; y: number };
export type ListLayout = Map<HTMLElement, Point>;

// A glide springs a block's `translate` from `from` back to zero, so its offset
// and speed are known at any moment and a new glide can take over smoothly.
const glides = new WeakMap<HTMLElement, { animation: Animation; from: Point; velocity: Point }>();

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * A block's glide offset and speed. Layout reads use the frame's animation time; a
 * glide that takes over uses the real time, because the compositor kept moving the
 * block while a long task (such as the list's commit) held the main thread.
 */
function glideState(element: HTMLElement, clock: 'frame' | 'now' = 'frame') {
  const glide = glides.get(element);
  if (!glide) return { offset: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } };
  const { currentTime, startTime } = glide.animation;
  const elapsed = clock === 'now' && startTime !== null ? performance.now() - Number(startTime) : Number(currentTime ?? 0);
  const seconds = Math.max(0, elapsed) / 1000;
  const x = springAt(GLIDE, glide.from.x, 0, glide.velocity.x, seconds);
  const y = springAt(GLIDE, glide.from.y, 0, glide.velocity.y, seconds);
  return { offset: { x: x.value, y: y.value }, velocity: { x: x.velocity, y: y.velocity } };
}

function startGlide(element: HTMLElement, from: Point, velocity: Point) {
  const seconds = Math.max(springSettleTime(GLIDE, from.x, 0, velocity.x), springSettleTime(GLIDE, from.y, 0, velocity.y));
  const steps = Math.max(2, Math.ceil(seconds * 120));
  const px = (value: number) => `${Math.round(value * 100) / 100}px`;
  const frames = Array.from({ length: steps + 1 }, (_, step) => {
    const at = seconds * step / steps;
    return { translate: step === steps ? '0px 0px'
      : `${px(springAt(GLIDE, from.x, 0, velocity.x, at).value)} ${px(springAt(GLIDE, from.y, 0, velocity.y, at).value)}` };
  });
  const animation = element.animate(frames, { duration: seconds * 1000 });
  glides.set(element, { animation, from, velocity });
  const done = () => { if (glides.get(element)?.animation === animation) glides.delete(element); };
  animation.addEventListener('finish', done);
  animation.addEventListener('cancel', done);
}

function parentBlock(element: HTMLElement, root: HTMLElement) {
  const parent = element.parentElement?.closest<HTMLElement>(BLOCKS);
  return parent && root.contains(parent) ? parent : null;
}

export function listRoot(element: Element) {
  return element.closest<HTMLElement>(ROOT);
}

/** Where each visible block sits in the page, without the glide that may still be moving it. */
export function measureList(root: HTMLElement | null): ListLayout {
  const layout: ListLayout = new Map();
  if (!root) return layout;
  for (const element of root.querySelectorAll<HTMLElement>(BLOCKS)) {
    if (element.dataset.leaving !== undefined || !element.getClientRects().length) continue;
    const box = element.getBoundingClientRect();
    const place = { x: box.left + window.scrollX, y: box.top + window.scrollY };
    for (let node: HTMLElement | null = element; node; node = parentBlock(node, root)) {
      const { offset } = glideState(node);
      place.x -= offset.x;
      place.y -= offset.y;
    }
    layout.set(element, place);
  }
  return layout;
}

/** Move blocks from where they were seen to their new places; new blocks fade in. */
export function glideList(root: HTMLElement | null, before: ListLayout) {
  if (!root?.animate || !before.size || reducedMotion()) return;
  const after = measureList(root);
  // Read every running glide before any of them is replaced.
  const running = new Map<HTMLElement, ReturnType<typeof glideState>>();
  const seen = new Map<HTMLElement, Point>();
  for (const element of after.keys()) {
    const state = glideState(element, 'now');
    const parent = parentBlock(element, root);
    const inherited = (parent && seen.get(parent)) || { x: 0, y: 0 };
    running.set(element, state);
    seen.set(element, { x: inherited.x + state.offset.x, y: inherited.y + state.offset.y });
  }
  const starts = new Map<HTMLElement, Point>();
  for (const [element, place] of after) {
    const parent = parentBlock(element, root);
    const inherited = (parent && starts.get(parent)) || { x: 0, y: 0 };
    const was = before.get(element);
    if (!was) {
      starts.set(element, inherited);
      if (!parent || before.has(parent)) element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
      continue;
    }
    // Keep each block where it appeared, relative to a parent that moves too.
    const total = seen.get(element)!;
    const own = { x: was.x + total.x - place.x - inherited.x, y: was.y + total.y - place.y - inherited.y };
    const { offset, velocity } = running.get(element)!;
    const glide = glides.get(element);
    if (glide && Math.abs(own.x - offset.x) < 0.5 && Math.abs(own.y - offset.y) < 0.5) {
      starts.set(element, { x: inherited.x + offset.x, y: inherited.y + offset.y });
      continue;
    }
    glide?.animation.cancel();
    if (Math.abs(own.x) < 0.5 && Math.abs(own.y) < 0.5) {
      starts.set(element, inherited);
      continue;
    }
    starts.set(element, { x: inherited.x + own.x, y: inherited.y + own.y });
    startGlide(element, own, velocity);
  }
}

/** Glide the page into its next arrangement once a parcel card is added or removed. */
export function glideNextListChange(root: HTMLElement | null, timeout = 8000): () => void {
  if (!root || typeof MutationObserver === 'undefined' || reducedMotion()) return () => undefined;
  const before = measureList(root);
  const touchesCard = (node: Node) => node instanceof HTMLElement && (node.matches(CARD) || Boolean(node.querySelector(CARD)));
  const observer = new MutationObserver((records) => {
    if (!records.some((record) => [...record.addedNodes, ...record.removedNodes].some(touchesCard))) return;
    stop();
    glideList(root, before);
  });
  const timer = setTimeout(() => stop(), timeout);
  function stop() {
    observer.disconnect();
    clearTimeout(timer);
  }
  observer.observe(root, { childList: true, subtree: true });
  return stop;
}

/** Fade a row where it stands; with `reflow`, the blocks after it close the gap at the same time. */
export function leaveList(row: HTMLElement, reflow: boolean) {
  const root = listRoot(row);
  const before = reflow ? measureList(root) : null;
  glides.get(row)?.animation.cancel();
  if (reflow && row.parentElement) {
    const box = row.getBoundingClientRect();
    const parent = row.parentElement.getBoundingClientRect();
    Object.assign(row.style, {
      position: 'absolute', margin: '0', width: `${box.width}px`, height: `${box.height}px`,
      left: `${box.left - parent.left - row.parentElement.clientLeft}px`, top: `${box.top - parent.top - row.parentElement.clientTop}px`,
    });
  }
  row.dataset.leaving = '';
  row.style.pointerEvents = 'none';
  if (before) glideList(root, before);
  const fade = row.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: reducedMotion() ? 120 : 200, easing: 'ease-out', fill: 'forwards' });
  return {
    faded: fade ? fade.finished.then(() => undefined, () => undefined) : Promise.resolve(),
    /** Put the row back when it did not leave after all. */
    restore() {
      const before = reflow ? measureList(root) : null;
      for (const property of ['position', 'margin', 'width', 'height', 'left', 'top', 'pointer-events']) row.style.removeProperty(property);
      delete row.dataset.leaving;
      if (before) glideList(root, before);
      fade?.cancel();
      row.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    },
  };
}
