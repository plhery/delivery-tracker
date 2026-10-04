import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindCardDialog, captureCardOrigin, type CardDialog } from './cardTransition';

type Rect = { left: number; top: number; width: number; height: number };

class FakeAnimation {
  playState = 'running';
  startTime: number | null = null;
  currentTime = 0;
  finished: Promise<void>;
  #resolve!: () => void;
  #reject!: (reason: unknown) => void;
  constructor(readonly target: Element, readonly frames: Keyframe[], readonly options: KeyframeAnimationOptions) {
    this.finished = new Promise((resolve, reject) => { this.#resolve = resolve; this.#reject = reject; });
    // A browser marks a cancelled animation's promise as handled.
    this.finished.catch(() => undefined);
  }
  get id() { return this.options.id ?? ''; }
  get effect() { return { getComputedTiming: () => ({ duration: this.options.duration }) }; }
  cancel() { this.playState = 'idle'; this.#reject(new DOMException('cancelled', 'AbortError')); }
  finish() { this.playState = 'finished'; this.#resolve(); }
}

const PAGE: Rect = { left: 0, top: 0, width: 390, height: 844 };
const HEADER: Rect = { left: 0, top: 0, width: 390, height: 64 };
const HERO: Rect = { left: 16, top: 127, width: 358, height: 348 };
const CARD: Rect = { left: 20, top: 428, width: 350, height: 102 };

let media: Record<string, boolean>;
let animations: FakeAnimation[];
let bound: CardDialog | null;

/** Lay an element out; one inside a moved and scaled page is measured where the page draws it. */
function place(element: HTMLElement, rect: () => Rect, page?: HTMLElement) {
  element.getBoundingClientRect = () => {
    const [x, y, scale] = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(page?.style.transform ?? '')?.slice(1).map(Number) ?? [0, 0, 1];
    const box = rect();
    const left = x + box.left * scale, top = y + box.top * scale, width = box.width * scale, height = box.height * scale;
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
  };
}

/** The part of the page a keyframe shows, on screen. */
function shown(frame: Keyframe) {
  const [, x, y, scale] = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(String(frame.transform))!.map(Number);
  const [, top, right, bottom, left, radius] = /inset\(([-\d.]+)px ([-\d.]+)px ([-\d.]+)px ([-\d.]+)px round ([-\d.]+)px\)/.exec(String(frame.clipPath))!.map(Number);
  return {
    left: x + left * scale, top: y + top * scale, width: (PAGE.width - left - right) * scale, height: (PAGE.height - top - bottom) * scale,
    scale, radius: radius * scale, opacity: Number(frame.opacity),
  };
}

function setup({ scrolled = 0, withCard = true, canPull = () => true }: { scrolled?: number; withCard?: boolean; canPull?: () => boolean } = {}) {
  document.body.innerHTML = `<main><button id="card"></button></main>
    <div id="backdrop" style="background-color: rgba(15, 22, 15, 0.28)"><div id="page"><header id="header"></header><section id="hero" style="border-top-left-radius: 20px"><button id="inside"></button></section><input id="field"></div></div>`;
  const element = (id: string) => document.getElementById(id)!;
  const page = element('page');
  const card = element('card');
  card.style.borderTopLeftRadius = '16px';
  Object.defineProperties(page, { offsetWidth: { value: PAGE.width }, offsetHeight: { value: PAGE.height } });
  page.scrollTop = scrolled;
  place(page, () => PAGE, page);
  place(element('header'), () => HEADER, page);
  place(element('hero'), () => ({ ...HERO, top: HERO.top - page.scrollTop }), page);
  place(card, () => CARD);
  const onClosed = vi.fn();
  const origin = withCard ? captureCardOrigin(card) : null;
  bound = bindCardDialog(page, {
    origin, card: () => withCard ? card : null, anchor: () => element('hero'), header: () => element('header'), canPull, onClosed,
  });
  return { page, card, backdrop: element('backdrop'), inside: element('inside'), field: element('field'), onClosed, origin };
}

let clock = 0;
function touch(target: HTMLElement, type: string, point?: { x: number; y: number }, { cancelable = true, after = 0 } = {}) {
  const event = new Event(type, { bubbles: true, cancelable });
  clock += after;
  Object.defineProperties(event, {
    touches: { value: point ? [{ identifier: 1, target, clientX: point.x, clientY: point.y }] : [] },
    timeStamp: { value: clock },
  });
  target.dispatchEvent(event);
  return event;
}

/** A finger that lands at (200, 300), moves by the given distances, `pace` milliseconds apart unless a move says otherwise, and lifts. */
function pull(target: HTMLElement, moves: [dx: number, dy: number, after?: number][], lift = true, pace = 200) {
  touch(target, 'touchstart', { x: 200, y: 300 });
  const events = moves.map(([dx, dy, after = pace]) => touch(target, 'touchmove', { x: 200 + dx, y: 300 + dy }, { after }));
  if (lift) touch(target, 'touchend', undefined, { after: 16 });
  return events;
}

const named = (id: string) => animations.filter((animation) => animation.id === id);

beforeEach(() => {
  media = { '(max-width: 760px)': true, '(prefers-reduced-motion: reduce)': false };
  animations = [];
  bound = null;
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: media[query] ?? false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  HTMLElement.prototype.animate = function (frames, options) {
    const animation = new FakeAnimation(this, frames as Keyframe[], options as KeyframeAnimationOptions);
    animations.push(animation);
    return animation as unknown as Animation;
  };
});

afterEach(() => {
  bound?.release();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  document.body.innerHTML = '';
});

describe('captureCardOrigin', () => {
  it('remembers a card on a phone, and nothing on a wide screen, with reduced motion or out of sight', () => {
    const { card } = setup({ withCard: false });
    expect(captureCardOrigin(card)).toMatchObject({ card, left: 20, top: 428, width: 350, height: 102, radius: 16 });
    expect(captureCardOrigin()).toBeNull();
    place(card, () => ({ ...CARD, top: 900 }));
    expect(captureCardOrigin(card)).toBeNull();
    place(card, () => CARD);
    media['(prefers-reduced-motion: reduce)'] = true;
    expect(captureCardOrigin(card)).toBeNull();
    media['(prefers-reduced-motion: reduce)'] = false;
    media['(max-width: 760px)'] = false;
    expect(captureCardOrigin(card)).toBeNull();
  });
});

describe('a page that opens out of its card', () => {
  it('starts as its card, showing the hero in the card’s place, and ends as the whole page', () => {
    setup();
    const [opening] = named('parcel-card-expand');
    const first = shown(opening.frames[0]);
    expect(first.left).toBeCloseTo(CARD.left, 1);
    expect(first.top).toBeCloseTo(CARD.top, 1);
    expect(first.width).toBeCloseTo(CARD.width, 1);
    expect(first.height).toBeCloseTo(CARD.height, 1);
    expect(first.scale).toBeCloseTo(CARD.width / HERO.width, 3);
    // Round like the hero, whose own corners would otherwise show the page behind them.
    expect(first.radius).toBeCloseTo(20 * CARD.width / HERO.width, 1);
    expect(first.opacity).toBe(0);
    expect(shown(opening.frames.at(-1)!)).toEqual({ left: 0, top: 0, width: 390, height: 844, scale: 1, radius: 0, opacity: 1 });
    // The window only grows, and the page is fully there long before it has.
    const heights = opening.frames.map((frame) => shown(frame).height);
    expect(heights.every((height, index) => index === 0 || height >= heights[index - 1] - 0.01)).toBe(true);
    expect(opening.frames.findIndex((frame) => frame.opacity === 1)).toBeLessThan(opening.frames.length / 4);
    // The hero's words wait until the page has covered the card's, so the two never show together.
    const [words] = named('parcel-card-expand-words');
    expect(words.target).toBe(document.getElementById('inside'));
    expect(words.frames).toHaveLength(opening.frames.length);
    const covered = opening.frames.findIndex((frame) => Number(frame.opacity) > 0.8);
    expect(Number(words.frames[covered].opacity)).toBeLessThan(0.2);
    expect(words.frames.at(-1)!.opacity).toBe(1);
  });

  it('arrives on its own without a card, on a wide screen and with reduced motion', () => {
    setup({ withCard: false });
    expect(animations).toEqual([]);
    media['(max-width: 760px)'] = false;
    const { card } = setup({ withCard: false });
    bound!.release();
    bound = bindCardDialog(document.getElementById('page')!, { origin: { card, ...CARD, radius: 16 }, card: () => card, canPull: () => true, onClosed: vi.fn() });
    expect(animations).toEqual([]);
  });
});

describe('closing', () => {
  it('returns the page to its card and reports it closed once it has faded there', async () => {
    const { onClosed, backdrop } = setup();
    named('parcel-card-expand')[0].finish();
    await Promise.resolve();
    bound!.close();
    const [leaving] = named('detail-card-return');
    expect(shown(leaving.frames[0])).toMatchObject({ left: 0, top: 0, width: 390, height: 844, opacity: 1 });
    const last = shown(leaving.frames.at(-1)!);
    expect(last.opacity).toBe(0);
    expect(Math.abs(last.left - CARD.left)).toBeLessThan(2);
    expect(Math.abs(last.top - CARD.top)).toBeLessThan(6);
    expect(Math.abs(last.width - CARD.width)).toBeLessThan(2);
    expect(Math.abs(last.height - CARD.height)).toBeLessThan(12);
    expect(leaving.options.fill).toBe('forwards');
    // The hero's words have left before the page gives way to the card and its own.
    const [words] = named('detail-card-return-words');
    const giving = leaving.frames.findIndex((frame) => Number(frame.opacity) < 1);
    expect(words.frames[0].opacity).toBe(1);
    expect(words.frames[giving].opacity).toBe(0);
    // The dim behind the page lifts with it.
    const dim = animations.find((animation) => animation.target === backdrop)!;
    expect(dim.frames.map((frame) => frame.backgroundColor)).toEqual(['rgba(15, 22, 15, 0.28)', 'rgba(15, 22, 15, 0)']);
    expect(onClosed).not.toHaveBeenCalled();
    bound!.close();
    expect(named('detail-card-return')).toHaveLength(1);
    leaving.finish();
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });

  it('leaves from wherever an interrupted opening had brought it', () => {
    setup();
    const [opening] = named('parcel-card-expand');
    opening.playState = 'paused';
    opening.currentTime = 60;
    bound!.close();
    expect(opening.playState).toBe('idle');
    const start = shown(named('detail-card-return')[0].frames[0]);
    expect(start.height).toBeGreaterThan(CARD.height);
    expect(start.height).toBeLessThan(PAGE.height);
  });

  it('shrinks a scrolled page into its card whole, once the hero has left the screen', () => {
    setup({ scrolled: 400 });
    bound!.close();
    const last = named('detail-card-return')[0].frames.at(-1)!;
    expect(shown(last).scale).toBeCloseTo(CARD.width / PAGE.width, 1);
    expect(String(last.clipPath)).toMatch(/^inset\([\d.]+px 0px [\d.]+px 0px /);
    expect(named('detail-card-return-words')).toEqual([]);
  });

  it('keeps the visible part of a slightly scrolled hero on the card, below the header', () => {
    setup({ scrolled: 100 });
    bound!.close();
    const last = named('detail-card-return')[0].frames.at(-1)!;
    // The window's top ends at the header's lower edge, where the hero still shows.
    expect(Number(/inset\(([\d.]+)px/.exec(String(last.clipPath))![1])).toBeGreaterThan(55);
    expect(shown(last).scale).toBeCloseTo(CARD.width / HERO.width, 1);
  });

  it('sinks away on a phone when no card is in sight, and leaves sideways on a wide screen', async () => {
    const phone = setup({ withCard: false });
    bound!.close();
    const sinking = animations.find((animation) => animation.target === phone.page)!;
    expect(sinking.frames).toHaveLength(2);
    expect(shown(sinking.frames[1])).toMatchObject({ opacity: 0, scale: 0.94 });
    sinking.finish();
    await vi.waitFor(() => expect(phone.onClosed).toHaveBeenCalled());
    bound!.release();
    animations = [];
    media['(max-width: 760px)'] = false;
    const wide = setup({ withCard: false });
    bound!.close();
    expect(animations.find((animation) => animation.target === wide.page)!.frames[1]).toEqual({ opacity: 0, transform: 'translateX(24px)' });
  });

  it('closes at once with reduced motion or without animations, and says nothing once released', async () => {
    const { onClosed } = setup({ withCard: false });
    media['(prefers-reduced-motion: reduce)'] = true;
    bound!.close();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(animations).toEqual([]);
    bound!.release();
    media['(prefers-reduced-motion: reduce)'] = false;
    const released = setup({ withCard: false });
    bound!.close();
    bound!.release();
    animations.at(-1)!.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(released.onClosed).not.toHaveBeenCalled();
  });
});

describe('pulling the page down', () => {
  it('carries the page with the finger, shrinking it around the point it holds', () => {
    const { page, backdrop } = setup({ withCard: false });
    const [slop, first, second] = pull(page, [[0, 5], [0, 28], [10, 108]], false);
    // Nothing moves, and the browser keeps the touch, until the finger has travelled.
    expect(slop.defaultPrevented).toBe(false);
    expect(first.defaultPrevented).toBe(true);
    expect(second.defaultPrevented).toBe(true);
    const [, x, y, scale] = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(page.style.transform)!.map(Number);
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThan(0.9);
    // The touched point is still under the finger: 100 px lower, after the slop.
    expect(y + 300 * scale).toBeCloseTo(400, 0);
    expect(x + 200 * scale).toBeCloseTo(207, 0);
    expect(page.style.clipPath).toMatch(/^inset\(0px 0px 0px 0px round [\d.]+px\)$/);
    expect(backdrop.style.backgroundColor).toMatch(/^rgba\(15, 22, 15, 0\.2[0-7]\d*\)$/);
    touch(page, 'touchend');
  });

  it('settles back after a short pull, and swallows the tap that would follow', async () => {
    const { page, inside, onClosed } = setup({ withCard: false });
    const clicked = vi.fn();
    inside.addEventListener('click', clicked);
    pull(inside, [[0, 30], [0, 70]]);
    const [settling] = named('detail-pull-settle');
    expect(shown(settling.frames.at(-1)!)).toMatchObject({ left: 0, top: 0, scale: 1, radius: 0, opacity: 1 });
    expect(page.style.transform).toBe('');
    expect(page.style.clipPath).toBe('');
    expect(onClosed).not.toHaveBeenCalled();
    inside.click();
    expect(clicked).not.toHaveBeenCalled();
    // A new pull waits for the page to be back.
    pull(page, [[0, 30], [0, 70]], false);
    expect(page.style.transform).toBe('');
    settling.finish();
    await Promise.resolve();
    pull(page, [[0, 30], [0, 70]], false);
    expect(page.style.transform).not.toBe('');
    touch(page, 'touchcancel');
  });

  it('closes into the card after a long pull', async () => {
    const { page, onClosed } = setup();
    named('parcel-card-expand')[0].finish();
    await Promise.resolve();
    pull(page, [[0, 40], [0, 120], [0, 230]]);
    const [leaving] = named('detail-card-return');
    const start = shown(leaving.frames[0]);
    expect(start.scale).toBeLessThan(0.95);
    expect(start.top).toBeGreaterThan(200);
    const last = shown(leaving.frames.at(-1)!);
    expect(last.opacity).toBe(0);
    expect(Math.abs(last.left - CARD.left)).toBeLessThan(8);
    expect(page.style.transform).toBe('');
    leaving.finish();
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });

  it('closes on a quick flick, but not when the finger rested or was on its way back up', () => {
    const flicked = setup({ withCard: false });
    pull(flicked.page, [[0, 20], [0, 50], [0, 90]], true, 16);
    expect(named('detail-pull-settle')).toHaveLength(0);
    expect(animations.some((animation) => animation.target === flicked.page && animation.options.fill === 'forwards')).toBe(true);
    bound!.release();
    animations = [];
    const rested = setup({ withCard: false });
    pull(rested.page, [[0, 20], [0, 50], [0, 90]], false, 16);
    touch(rested.page, 'touchend', undefined, { after: 300 });
    expect(named('detail-pull-settle')).toHaveLength(1);
    bound!.release();
    animations = [];
    const returning = setup({ withCard: false });
    pull(returning.page, [[0, 20], [0, 300], [0, 250, 100], [0, 200]], true, 16);
    expect(named('detail-pull-settle')).toHaveLength(1);
  });

  it('leaves the touch alone when the page is scrolled, busy, pulled sideways or upwards, or in a field', () => {
    const scrolled = setup({ scrolled: 40, withCard: false });
    expect(pull(scrolled.page, [[0, 60]])[0].defaultPrevented).toBe(false);
    bound!.release();
    const busy = setup({ withCard: false, canPull: () => false });
    expect(pull(busy.page, [[0, 60]])[0].defaultPrevented).toBe(false);
    bound!.release();
    const { page, field } = setup({ withCard: false });
    expect(pull(page, [[60, 30]])[0].defaultPrevented).toBe(false);
    expect(pull(page, [[0, -60]])[0].defaultPrevented).toBe(false);
    expect(pull(field, [[0, 60]])[0].defaultPrevented).toBe(false);
    page.setAttribute('inert', '');
    expect(pull(page, [[0, 60]])[0].defaultPrevented).toBe(false);
    page.removeAttribute('inert');
    media['(max-width: 760px)'] = false;
    expect(pull(page, [[0, 60]])[0].defaultPrevented).toBe(false);
    expect(page.style.transform).toBe('');
    expect(animations).toEqual([]);
  });

  it('ends the pull when a second finger lands or the browser takes the touch back', () => {
    const { page } = setup({ withCard: false });
    pull(page, [[0, 30], [0, 60]], false);
    expect(page.style.transform).not.toBe('');
    touch(page, 'touchstart', { x: 100, y: 100 });
    expect(named('detail-pull-settle')).toHaveLength(1);
    expect(page.style.transform).toBe('');
    named('detail-pull-settle')[0].finish();
    return Promise.resolve().then(() => {
      pull(page, [[0, 30]], false);
      touch(page, 'touchmove', { x: 200, y: 380 }, { cancelable: false, after: 200 });
      expect(named('detail-pull-settle')).toHaveLength(2);
    });
  });

  it('settles back, however far it was pulled, when the system takes the touch away', () => {
    const { page, onClosed } = setup({ withCard: false });
    pull(page, [[0, 30], [0, 300]], false);
    touch(page, 'touchcancel', undefined, { after: 16 });
    expect(named('detail-pull-settle')).toHaveLength(1);
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('can be pulled once its opening is all but over, and not before', () => {
    const { page } = setup();
    const [opening] = named('parcel-card-expand');
    opening.playState = 'paused';
    opening.currentTime = 80;
    pull(page, [[0, 30], [0, 90]]);
    expect(opening.playState).toBe('paused');
    expect(page.style.transform).toBe('');
    opening.currentTime = 520;
    pull(page, [[0, 30], [0, 90]], false);
    expect(opening.playState).toBe('idle');
    expect(page.style.transform).not.toBe('');
    touch(page, 'touchend', undefined, { after: 300 });
  });

  it('closes or snaps back without motion when motion is reduced', () => {
    const { page, onClosed } = setup({ withCard: false });
    media['(prefers-reduced-motion: reduce)'] = true;
    pull(page, [[0, 30], [0, 60]]);
    expect(page.style.transform).toBe('');
    expect(onClosed).not.toHaveBeenCalled();
    pull(page, [[0, 30], [0, 260]]);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(animations).toEqual([]);
  });
});
