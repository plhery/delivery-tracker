import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParcelAddedBurst } from './ParcelAddedBurst';

let card: HTMLDivElement;
let button: HTMLButtonElement;
let stamp: HTMLSpanElement;
let bounds: DOMRect;
let stampBounds: DOMRect;
let hidden: boolean;
let media: EventTarget & { matches: boolean };
let nextFrame: number;
const frames = new Map<number, FrameRequestCallback>();
const animations: { element: Element; cancel: ReturnType<typeof vi.fn> }[] = [];
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
const animate = vi.fn(function (this: Element) {
  const animation = { element: this, cancel: vi.fn() };
  animations.push(animation);
  return animation;
});

function advance(count = 5, milliseconds = 16) {
  act(() => {
    for (let index = 0; index < count; index++) {
      vi.advanceTimersByTime(milliseconds);
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(performance.now()));
    }
  });
}

function mount() {
  const onFinished = vi.fn();
  const view = render(<ParcelAddedBurst parcelId="new-parcel" onFinished={onFinished} />);
  const cloud = document.querySelector<HTMLElement>('.parcel-added-burst')!;
  return { ...view, cloud, onFinished };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  hidden = false;
  nextFrame = 0;
  frames.clear();
  animations.length = 0;
  animate.mockClear();
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', () => media);
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: animate });

  card = document.createElement('div');
  card.className = 'parcel-card-swipe';
  card.dataset.parcelId = 'new-parcel';
  button = document.createElement('button');
  button.className = 'parcel-card';
  stamp = document.createElement('span');
  stamp.className = 'parcel-card__stub';
  button.append(stamp);
  card.append(button);
  document.body.append(card);
  bounds = new DOMRect(20, 200, 350, 140);
  stampBounds = new DOMRect(300, 250, 40, 40);
  vi.spyOn(card, 'getBoundingClientRect').mockImplementation(() => bounds);
  vi.spyOn(card, 'getClientRects').mockImplementation(() => Object.assign([bounds], { item: () => bounds }));
  vi.spyOn(stamp, 'getBoundingClientRect').mockImplementation(() => stampBounds);
  Object.assign(card, { scrollIntoView: vi.fn() });
});

afterEach(() => {
  cleanup();
  card.remove();
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(Element.prototype, 'animate');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ParcelAddedBurst', () => {
  it('waits for a stable card, follows its stamp, focuses it, and releases the celebration on completion', () => {
    const { cloud, onFinished } = mount();
    expect(cloud).toHaveAttribute('aria-hidden', 'true');
    advance(4);
    expect(animate).not.toHaveBeenCalled();
    advance(1);
    expect(cloud).toHaveAttribute('data-phase', 'playing');
    expect(card).toHaveAttribute('data-celebrating', 'rumble');
    expect(button).toHaveFocus();
    expect(animations.map(({ element }) => element)).toEqual([card, ...cloud.children]);
    expect(cloud.style.getPropertyValue('--burst-x')).toBe('320px');
    expect(cloud.style.getPropertyValue('--burst-y')).toBe('270px');
    stampBounds = new DOMRect(290, 220, 40, 40);
    advance(1);
    expect(cloud.style.getPropertyValue('--burst-x')).toBe('310px');
    expect(cloud.style.getPropertyValue('--burst-y')).toBe('240px');
    act(() => vi.advanceTimersByTime(950));
    expect(onFinished).toHaveBeenCalledOnce();
    expect(card).not.toHaveAttribute('data-celebrating');
    expect(animations.every(({ cancel }) => cancel.mock.calls.length === 1)).toBe(true);
    expect(frames.size).toBe(0);
    act(() => document.dispatchEvent(new Event('pointerdown')));
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it('uses a short highlight without flying parcels when reduced motion is enabled', () => {
    media.matches = true;
    const { cloud, onFinished } = mount();
    advance();
    expect(cloud).toHaveAttribute('data-reduced', 'true');
    expect(card).toHaveAttribute('data-celebrating', 'highlight');
    expect(button).toHaveFocus();
    expect(animate).toHaveBeenCalledExactlyOnceWith(
      expect.arrayContaining([expect.objectContaining({ filter: 'brightness(1.08)' })]),
      { duration: 750 },
    );
    act(() => vi.advanceTimersByTime(750));
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it.each([false, true])('scrolls an offscreen card into view before launching (reduced motion: %s)', (reduced) => {
    media.matches = reduced;
    bounds = new DOMRect(20, 900, 350, 140);
    mount();
    advance(1);
    expect(card.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ behavior: reduced ? 'instant' : 'smooth', block: 'center' });
    expect(animate).not.toHaveBeenCalled();
    bounds = new DOMRect(20, 200, 350, 140);
    advance();
    expect(card).toHaveAttribute('data-celebrating');
    expect(card.scrollIntoView).toHaveBeenCalledOnce();
  });

  it('anchors to the card when no stamp is present and media queries are unavailable', () => {
    stamp.remove();
    vi.stubGlobal('matchMedia', undefined);
    const { cloud } = mount();
    advance();
    expect(cloud).toHaveAttribute('data-reduced', 'false');
    expect(cloud.style.getPropertyValue('--burst-x')).toBe('340px');
    expect(cloud.style.getPropertyValue('--burst-y')).toBe('270px');
    expect(card).toHaveAttribute('data-celebrating', 'rumble');
  });

  it.each(['missing', 'hidden', 'inert'] as const)('waits for a %s card to become available', (state) => {
    if (state === 'missing') card.remove();
    if (state === 'hidden') vi.mocked(card.getClientRects).mockReturnValue(Object.assign([], { item: () => null }));
    if (state === 'inert') card.setAttribute('inert', '');
    const { onFinished } = mount();
    advance(1);
    expect(animate).not.toHaveBeenCalled();
    expect(onFinished).not.toHaveBeenCalled();
    document.body.append(card);
    vi.mocked(card.getClientRects).mockImplementation(() => Object.assign([bounds], { item: () => bounds }));
    card.removeAttribute('inert');
    advance();
    expect(card).toHaveAttribute('data-celebrating', 'rumble');
  });

  it.each(['missing', 'offscreen'] as const)('gives up when the card stays %s', (state) => {
    if (state === 'missing') card.remove();
    else bounds = new DOMRect(20, -200, 350, 140);
    const { onFinished } = mount();
    advance(1, 1501);
    expect(onFinished).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('launches a visible card after the settling deadline even if its position keeps changing', () => {
    mount();
    advance(1);
    bounds = new DOMRect(20, 210, 350, 140);
    advance(1, 1201);
    expect(card).toHaveAttribute('data-celebrating', 'rumble');
  });

  it.each(['button', 'animation'] as const)('finishes gracefully when the %s is unavailable', (missing) => {
    if (missing === 'button') button.remove();
    else Reflect.deleteProperty(Element.prototype, 'animate');
    const { onFinished } = mount();
    advance();
    expect(onFinished).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
  });

  it.each(['missing', 'hidden'] as const)('stops if the playing card becomes %s', (state) => {
    const { onFinished } = mount();
    advance();
    if (state === 'missing') card.remove();
    else vi.mocked(card.getClientRects).mockReturnValue(Object.assign([], { item: () => null }));
    advance(1);
    expect(onFinished).toHaveBeenCalledOnce();
    expect(animations.every(({ cancel }) => cancel.mock.calls.length === 1)).toBe(true);
    expect(frames.size).toBe(0);
  });

  it.each(['pointerdown', 'keydown', 'wheel', 'popstate', 'motion', 'visibility', 'width'] as const)(
    'cancels animations on %s', (reason) => {
      const { onFinished } = mount();
      advance();
      act(() => {
        if (reason === 'motion') media.dispatchEvent(new Event('change'));
        else if (reason === 'visibility') {
          hidden = true;
          document.dispatchEvent(new Event('visibilitychange'));
        } else if (reason === 'width') {
          vi.stubGlobal('innerWidth', 844);
          window.dispatchEvent(new Event('resize'));
        } else if (reason === 'popstate') window.dispatchEvent(new Event(reason));
        else document.dispatchEvent(new Event(reason));
        vi.advanceTimersByTime(2000);
      });
      expect(onFinished).toHaveBeenCalledOnce();
      expect(card).not.toHaveAttribute('data-celebrating');
      expect(animations.every(({ cancel }) => cancel.mock.calls.length === 1)).toBe(true);
      expect(frames.size).toBe(0);
    },
  );

  it('ignores keyboard height changes and visibility events while the page stays visible', () => {
    const { onFinished } = mount();
    advance();
    act(() => {
      vi.stubGlobal('innerHeight', 780);
      window.dispatchEvent(new Event('resize'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(onFinished).not.toHaveBeenCalled();
    expect(card).toHaveAttribute('data-celebrating');
  });

  it('does not launch while the page is hidden', () => {
    hidden = true;
    const { onFinished } = mount();
    advance(1);
    expect(onFinished).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('releases animations, frames, timers, and listeners on unmount without reporting completion', () => {
    const { unmount, onFinished, cloud } = mount();
    advance();
    unmount();
    expect(cloud).not.toBeInTheDocument();
    expect(card).not.toHaveAttribute('data-celebrating');
    expect(animations.every(({ cancel }) => cancel.mock.calls.length === 1)).toBe(true);
    expect(frames.size).toBe(0);
    act(() => {
      document.dispatchEvent(new Event('pointerdown'));
      document.dispatchEvent(new Event('keydown'));
      document.dispatchEvent(new Event('wheel'));
      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      vi.stubGlobal('innerWidth', 844);
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('popstate'));
      media.dispatchEvent(new Event('change'));
      vi.advanceTimersByTime(2000);
    });
    expect(onFinished).not.toHaveBeenCalled();
  });
});
