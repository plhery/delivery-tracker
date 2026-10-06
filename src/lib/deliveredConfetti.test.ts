import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throwConfetti } from './deliveredConfetti';

const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

/** A list with its cards; `inside` is what each card holds, and where on the screen it is. */
function list(cards: { id: string; hero?: boolean; arrived?: boolean; inside: string; at?: DOMRect }[]) {
  const root = document.createElement('main');
  for (const { id, hero, arrived = true, inside, at } of cards) {
    const card = document.createElement('div');
    card.className = `parcel-card-swipe${hero ? ' parcel-card-swipe--hero' : ''}`;
    card.dataset.parcelId = id;
    if (arrived) card.dataset.arrived = '';
    card.style.setProperty('--tone', 'navy');
    card.innerHTML = inside;
    const mark = card.querySelector('[data-pip] svg, g, .parcel-stamp');
    if (mark && at) mark.getBoundingClientRect = () => at;
    root.append(card);
  }
  document.body.append(root);
  return root;
}

const PIP = '<span data-pip="joy"><svg></svg></span>';
const ROUTE = '<svg><g data-kind="current"></g></svg>';
const paper = () => document.querySelector('.delivered-confetti');

describe('the paper thrown when a parcel has arrived', () => {
  let finish: (() => void)[] = [];
  let frames: Keyframe[][] = [];

  beforeEach(() => {
    finish = [];
    frames = [];
    Element.prototype.animate = vi.fn(function animate(this: Element, keyframes: Keyframe[]) {
      frames.push(keyframes);
      return { finished: new Promise<void>((resolve) => finish.push(resolve)) };
    }) as unknown as typeof Element.prototype.animate;
  });

  afterEach(() => {
    delete (Element.prototype as Partial<Element>).animate;
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('comes out of Pip’s open box on the large card, in the card’s colours, and is cleared once it has fallen', async () => {
    const root = list([{ id: 'tea', hero: true, inside: PIP, at: box(200, 180, 66, 68) }]);
    throwConfetti(root, ['tea'], undefined, 7);

    const layer = paper() as HTMLElement;
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer.parentElement).toBe(document.body);
    expect(layer.style.getPropertyValue('--tone')).toBe('navy');
    expect(layer.querySelectorAll('i')).toHaveLength(58);
    expect(layer.querySelectorAll('svg')).toHaveLength(6);
    // Every piece starts in the mouth of the box, and the first of them has gone up before it falls.
    const start = (keyframes: Keyframe[]) => String(keyframes[0].transform).match(/translate\(([\d.-]+)px, ([\d.-]+)px\)/)!.slice(1).map(Number);
    for (const keyframes of frames.slice(0, 58)) {
      const [x, y] = start(keyframes);
      expect(Math.abs(x - 233)).toBeLessThan(21);
      expect(y).toBeCloseTo(205.8, 0);
      expect(keyframes.at(-1)!.opacity).toBe(0);
    }
    const heights = frames[0].map((frame) => Number(String(frame.transform).match(/, ([\d.-]+)px\)/)![1]));
    expect(Math.min(...heights)).toBeLessThan(170);
    expect(heights.at(-1)).toBeGreaterThan(Math.min(...heights) + 150);

    finish.forEach((done) => done());
    await vi.waitFor(() => expect(paper()).toBeNull());
  });

  it('comes out of where the route ends on another card, with less of it, and can be cleared', () => {
    const root = list([{ id: 'tea', inside: ROUTE, at: box(300, 400, 8, 8) }]);
    const clear = throwConfetti(root, ['tea']);
    expect(paper()!.querySelectorAll('i')).toHaveLength(38);
    clear();
    expect(paper()).toBeNull();
  });

  it('is thrown once for parcels that arrive together, from the first card on screen', () => {
    const root = list([
      { id: 'far', hero: true, inside: PIP, at: box(200, -400, 66, 68) },
      { id: 'tea', inside: '<span class="parcel-stamp"></span>', at: box(320, 300, 44, 56) },
      { id: 'lamp', inside: ROUTE, at: box(300, 500, 8, 8) },
    ]);
    throwConfetti(root, ['far', 'tea', 'lamp']);
    expect(document.querySelectorAll('.delivered-confetti')).toHaveLength(1);
    expect(String(frames[0][0].transform)).toContain('328px');
  });

  it('is not thrown for a card that is not there, off screen or not held, nor where nothing moves', () => {
    const cards = [{ id: 'tea', hero: true, inside: PIP, at: box(200, 180, 66, 68) }];
    expect(throwConfetti(null, ['tea'])).toBeTypeOf('function');
    throwConfetti(list(cards), ['lamp']);
    throwConfetti(list([{ ...cards[0], arrived: false }]), ['tea']);
    throwConfetti(list([{ ...cards[0], at: box(200, 5000, 66, 68) }]), ['tea']);
    throwConfetti(list([{ id: 'tea', inside: '' }]), ['tea']);
    expect(paper()).toBeNull();

    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    throwConfetti(list(cards), ['tea']);
    expect(paper()).toBeNull();
    vi.unstubAllGlobals();

    delete (Element.prototype as Partial<Element>).animate;
    throwConfetti(list(cards), ['tea']);
    expect(paper()).toBeNull();
  });
});
