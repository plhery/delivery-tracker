import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveDeliveredCards } from './deliveredMove';

type Box = { left?: number; top: number; width?: number; height?: number };

function place(element: Element, box: Box) {
  const left = box.left ?? 20;
  const width = box.width ?? 350;
  const height = box.height ?? 102;
  const rect = { x: left, y: box.top, left, top: box.top, width, height, right: left + width, bottom: box.top + height, toJSON: () => ({}) } as DOMRect;
  (element as HTMLElement).getBoundingClientRect = () => rect;
  (element as HTMLElement).getClientRects = () => [rect] as unknown as DOMRectList;
}

function card(id: string, name: string, hero = false) {
  const row = document.createElement('div');
  row.className = `parcel-card-swipe${hero ? ' parcel-card-swipe--hero' : ''}`;
  row.dataset.parcelId = id;
  row.innerHTML = `<div class="parcel-card-swipe__clip"><button class="parcel-card"><strong class="parcel-card__label">${name}</strong></button></div>`;
  return row;
}

interface Started { element: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions; finish: () => void }

/** A stand-in for the browser's animations: what was started on which element, and a way to end each. */
function animations() {
  const started: Started[] = [];
  Element.prototype.animate = function animate(this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    let finish = () => undefined as void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    started.push({ element: this, keyframes, options, finish });
    return { finished, currentTime: 0, startTime: null, addEventListener() {}, cancel() {}, finish } as unknown as Animation;
  } as typeof Element.prototype.animate;
  return started;
}

const settled = () => new Promise((resolve) => setTimeout(resolve));

describe('a delivered card moves to the past deliveries', () => {
  let root: HTMLElement;
  let started: Started[];

  beforeEach(() => {
    document.body.innerHTML = `<div class="deliveries-page">
      <div class="delivery-next"></div>
      <div class="parcel-grid" id="way"></div>
      <section class="parcel-section parcel-section--past">
        <div class="parcel-section__heading"><h2>Past deliveries</h2><span>1</span></div>
        <div class="parcel-grid" id="past"></div>
      </section>
    </div>`;
    root = document.querySelector<HTMLElement>('.deliveries-page')!;
    root.querySelector('.delivery-next')!.append(card('tea', 'Tea', true));
    root.querySelector('#way')!.append(card('lamp', 'Lamp'));
    root.querySelector('#past')!.append(card('book', 'Book'));
    place(root.querySelector('[data-parcel-id="tea"]')!, { top: 100, height: 250 });
    place(root.querySelector('[data-parcel-id="tea"] .parcel-card__label')!, { top: 250, height: 30 });
    place(root.querySelector('[data-parcel-id="lamp"]')!, { top: 360 });
    place(root.querySelector('[data-parcel-id="lamp"] .parcel-card__label')!, { top: 395, height: 30 });
    place(root.querySelector('.parcel-section')!, { top: 480, height: 150 });
    place(root.querySelector('[data-parcel-id="book"]')!, { top: 520 });
    started = animations();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete (Element.prototype as Partial<Element>).animate;
    vi.unstubAllGlobals();
  });

  /** The list as it is once the tea has arrived: the lamp is Next up, the tea leads the past deliveries. */
  function arrive() {
    const tea = root.querySelector<HTMLElement>('[data-parcel-id="tea"]')!;
    const lamp = root.querySelector<HTMLElement>('[data-parcel-id="lamp"]')!;
    tea.remove();
    lamp.remove();
    const next = card('lamp', 'Lamp', true);
    const past = card('tea', 'Tea');
    root.querySelector('.delivery-next')!.append(next);
    root.querySelector('#past')!.prepend(past);
    root.querySelector('.parcel-section__heading span')!.textContent = '2';
    place(next, { top: 100, height: 250 });
    place(next.querySelector('.parcel-card__label')!, { top: 250, height: 30 });
    place(root.querySelector('.parcel-section')!, { top: 370, height: 262 });
    place(past, { top: 410 });
    place(past.querySelector('.parcel-card__label')!, { top: 445, height: 30 });
    place(root.querySelector('[data-parcel-id="book"]')!, { top: 522 });
    return { tea, lamp, next, past };
  }

  const on = (element: Element) => started.filter((animation) => animation.element === element);

  it('carries the card it was and a copy of the card it is in one box, from the old place to the new', async () => {
    moveDeliveredCards(root, ['tea']);
    const { tea, past } = arrive();
    await settled();

    const boxes = [...root.querySelectorAll<HTMLElement>('.delivered-moves > .delivered-move')];
    expect(boxes).toHaveLength(2);
    // The arrival is drawn last, over the card that takes its place.
    const box = boxes[1];
    expect(box).toHaveAttribute('aria-hidden', 'true');
    expect(box.style.top).toBe('410px');
    expect(box.style.height).toBe('250px');
    expect(box.contains(tea)).toBe(true);
    expect(tea).not.toHaveAttribute('data-parcel-id');
    const copy = box.querySelector<HTMLElement>('.delivered-move__next > .parcel-card-swipe')!;
    expect(copy).not.toBe(past);
    expect(copy).toHaveTextContent('Tea');
    expect(copy).not.toHaveAttribute('data-parcel-id');
    // A past delivery is paler: the copy stands where the rule that makes it so still reaches it.
    expect(copy.parentElement).toHaveClass('parcel-section--past');
    // Only the page's own card answers for the parcel.
    expect(root.querySelectorAll('[data-parcel-id="tea"]')).toHaveLength(1);

    const flight = on(box).find(({ keyframes }) => 'translate' in keyframes[0])!;
    expect(flight.keyframes[0]).toEqual({ translate: '0px -310px' });
    expect(flight.keyframes.at(-1)).toEqual({ translate: '0px 0px' });
    const clip = on(box.firstElementChild!)[0];
    expect(clip.keyframes[0]).toEqual({ clipPath: 'inset(0px 0px 0px 0px round 0px)' });
    expect(clip.keyframes.at(-1)).toEqual({ clipPath: 'inset(0px 0px 148px 0px round 0px)' });
    // The names stay on one line: the old card slides up by as much as the name stands lower in it.
    expect(on(tea)[0].keyframes.at(-1)).toEqual({ transform: 'translateY(-115px)' });
    expect(on(copy)[0].keyframes[0]).toEqual({ transform: 'translateY(115px)' });
    // A lifted card casts a shadow on its way.
    expect(on(box).some(({ keyframes }) => 'filter' in keyframes[0])).toBe(true);
  });

  it('keeps the page\'s own card unseen until the box lands on it, then takes the box away', async () => {
    moveDeliveredCards(root, ['tea']);
    const { past, next } = arrive();
    await settled();

    expect(on(past)).toEqual([expect.objectContaining({ keyframes: [{ opacity: 0 }, { opacity: 0 }] })]);
    expect(on(next)).toEqual([expect.objectContaining({ keyframes: [{ opacity: 0 }, { opacity: 0 }] })]);
    for (const animation of started.filter(({ keyframes }) => keyframes.length === 2 && keyframes[1].opacity === 0 && keyframes[0].opacity === 1)) animation.finish();
    await settled();
    expect(root.querySelector('.delivered-moves')).toBeNull();
    expect(root.querySelectorAll('.parcel-card-swipe')).toHaveLength(3);
  });

  it('grows the parcel that becomes Next up into its place, without a shadow', async () => {
    moveDeliveredCards(root, ['tea']);
    const { lamp } = arrive();
    await settled();

    const box = root.querySelector<HTMLElement>('.delivered-moves > .delivered-move')!;
    expect(box.contains(lamp)).toBe(true);
    expect(on(box).find(({ keyframes }) => 'translate' in keyframes[0])!.keyframes[0]).toEqual({ translate: '0px 260px' });
    expect(on(box.firstElementChild!)[0].keyframes[0]).toEqual({ clipPath: 'inset(0px 0px 148px 0px round 0px)' });
    expect(on(box).some(({ keyframes }) => 'filter' in keyframes[0])).toBe(false);
  });

  it('glides the blocks that stay and marks the counts that changed', async () => {
    moveDeliveredCards(root, ['tea']);
    arrive();
    await settled();

    expect(on(root.querySelector('.parcel-section')!)[0].keyframes[0]).toEqual({ translate: '0px 110px' });
    // The book kept its place in the page: it rides its section and then settles 2px lower.
    expect(on(root.querySelector('[data-parcel-id="book"]')!)[0].keyframes[0]).toEqual({ translate: '0px -112px' });
    expect(on(root.querySelector('.parcel-section__heading span')!)[0].keyframes[1]).toMatchObject({ scale: 1.22 });
  });

  it('leaves the list alone when motion is not wanted, or when it was called off', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
    moveDeliveredCards(root, ['tea']);
    arrive();
    await settled();
    expect(root.querySelector('.delivered-moves')).toBeNull();
    expect(started).toHaveLength(0);
  });

  it('does nothing once it has been called off', async () => {
    moveDeliveredCards(root, ['tea'])();
    arrive();
    await settled();
    expect(root.querySelector('.delivered-moves')).toBeNull();
    expect(started).toHaveLength(0);
  });
});
