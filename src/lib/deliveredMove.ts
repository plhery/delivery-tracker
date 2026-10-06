import { glideList, measureList } from './listGlide';
import { springAt, springSettleTime, type Spring } from './spring';

const COUNT = '.parcel-section__heading > span';

/** How a list draws its parcels, for what moves when one of them has arrived. */
export interface CardList {
  /** A parcel's card, and the attribute that names its parcel. */
  card: string;
  id: string;
  /** The parcel's name on a card, its coloured surface and what rounds its corners; the card itself where absent. */
  name: string;
  surface?: string;
  clip?: string;
  /** The large card, which throws more paper. */
  large: string;
  /** The blocks that make room when a card leaves; the deliveries' own where absent. */
  blocks?: string;
}

/** The deliveries. */
export const DELIVERY_CARDS: CardList = {
  card: '.parcel-card-swipe', id: 'data-parcel-id', name: '.parcel-card__label', surface: '.parcel-card', clip: '.parcel-card-swipe__clip',
  large: '.parcel-card-swipe--hero',
};

/** Slower than the list's glide and with a soft landing: the card is carried to its place. */
const TRAVEL: Spring = { duration: 0.62, bounce: 0.16 };
/** The page's own card shows again under the flying one, which then fades from over it. */
const HANDOVER = 90;

/** A card as it stood: where in the page, how large, and where its name is written. */
interface Seen {
  element: HTMLElement;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The middle of the parcel's name, from the card's top. */
  title: number;
  radius: number;
}

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

const px = (value: number) => `${Math.round(value * 100) / 100}px`;
const part = (value: number) => Math.min(1, Math.max(0, value));
const ramp = (value: number, from: number, to: number) => part((value - from) / (to - from));
const between = (from: number, to: number, share: number) => from + (to - from) * share;

function see(element: HTMLElement, place: { x: number; y: number } | undefined, list: CardList): Seen {
  const box = element.getBoundingClientRect();
  const name = element.querySelector(list.name)?.getBoundingClientRect();
  const clip = list.clip ? element.querySelector(list.clip) : element;
  return {
    element,
    x: place?.x ?? box.left + window.scrollX,
    y: place?.y ?? box.top + window.scrollY,
    width: box.width,
    height: box.height,
    title: name ? name.top + name.height / 2 - box.top : box.height / 2,
    radius: clip ? parseFloat(getComputedStyle(clip).borderTopLeftRadius) || 0 : 0,
  };
}

function cardsIn(root: HTMLElement, list: CardList) {
  const cards = new Map<string, HTMLElement>();
  for (const card of root.querySelectorAll<HTMLElement>(list.card)) {
    const id = card.getAttribute(list.id);
    if (id && card.dataset.leaving === undefined && card.getClientRects().length) cards.set(id, card);
  }
  return cards;
}

/** A card shown in the flying box: out of the list's reach, at the size it had in the page. */
function asFace(element: HTMLElement, { width, height }: Seen, list: CardList) {
  element.removeAttribute(list.id);
  element.dataset.leaving = '';
  Object.assign(element.style, { position: 'absolute', left: '0', top: '0', width: px(width), height: px(height), margin: '0' });
}

/** A copied canvas is blank: give each the picture of the one it was copied from. */
function copyPictures(from: HTMLElement, to: HTMLElement) {
  const drawn = from.querySelectorAll('canvas');
  to.querySelectorAll('canvas').forEach((canvas, index) => {
    const picture = drawn[index];
    if (!picture?.width || !picture.height) return;
    try {
      canvas.getContext('2d')?.drawImage(picture, 0, 0);
    } catch {
      // A map that cannot be copied is drawn again by the card itself once it shows.
    }
  });
}

/**
 * One card flies from where it stood to its new place, and becomes its new self on the way.
 * The card it was and a copy of the card it is ride in one box over the list: the box changes
 * size from its far edges, the old card slides so that both names stay on the same line, and
 * the new card comes up over it. The card in the page stays unseen until the box lands on it.
 */
function carry(layer: HTMLElement, was: Seen, now: Seen, lifted: boolean, list: CardList) {
  const frame = layer.getBoundingClientRect();
  const origin = { x: frame.left + window.scrollX, y: frame.top + window.scrollY };
  const from = { x: was.x - origin.x, y: was.y - origin.y };
  const to = { x: now.x - origin.x, y: now.y - origin.y };
  const wide = Math.max(was.width, now.width);
  const tall = Math.max(was.height, now.height);
  const distance = Math.hypot(from.x - to.x, from.y - to.y) + Math.abs(was.width - now.width) + Math.abs(was.height - now.height);
  const seconds = springSettleTime(TRAVEL, 0, Math.max(distance, 1), 0);
  const steps = Math.max(2, Math.ceil(seconds * 120));
  const along = Array.from({ length: steps + 1 }, (_, step) => step === steps ? 1 : springAt(TRAVEL, 0, 1, 0, seconds * step / steps).value);
  // A card that shrinks does so early in its flight and one that grows does so late, so two tall cards never cross.
  const shape = (progress: number) => now.height < was.height ? ramp(progress, 0, .72) : now.height > was.height ? ramp(progress, .28, 1) : part(progress);
  const shift = was.title - now.title;

  const box = document.createElement('div');
  box.className = 'delivered-move';
  box.inert = true;
  box.setAttribute('aria-hidden', 'true');
  Object.assign(box.style, { left: px(to.x), top: px(to.y), width: px(wide), height: px(tall) });
  const clip = document.createElement('div');
  clip.className = 'delivered-move__clip';
  const next = document.createElement('div');
  // A past delivery is paler: the copy keeps the place that makes it so.
  next.className = `delivered-move__next${now.element.closest('.parcel-section--past') ? ' parcel-section--past' : ''}`;
  const ground = document.createElement('div');
  ground.className = 'delivered-move__ground';
  const surface = list.surface ? now.element.querySelector(list.surface) : now.element;
  if (surface) ground.style.background = getComputedStyle(surface).backgroundColor;
  const copy = now.element.cloneNode(true) as HTMLElement;
  copyPictures(now.element, copy);
  asFace(was.element, was, list);
  asFace(copy, now, list);
  next.append(ground, copy);
  clip.append(was.element, next);
  box.append(clip);
  layer.append(box);
  // What a card plays when it enters the page has been seen: it is taken to its end.
  for (const animation of box.getAnimations?.({ subtree: true }) ?? []) {
    try {
      animation.finish();
    } catch {
      // A motion that never ends, such as Pip's, carries on.
    }
  }

  const timing = { duration: seconds * 1000, fill: 'both' } as const;
  box.animate(along.map((progress) => ({
    translate: `${px((from.x - to.x) * (1 - progress))} ${px((from.y - to.y) * (1 - progress))}`,
  })), { ...timing, id: 'delivered-flight' });
  clip.animate(along.map((progress) => {
    const share = shape(progress);
    return { clipPath: `inset(0px ${px(wide - between(was.width, now.width, share))} ${px(tall - between(was.height, now.height, share))} 0px round ${px(between(was.radius, now.radius, share))})` };
  }), timing);
  was.element.animate(along.map((progress) => ({ transform: `translateY(${px(-shift * shape(progress))})` })), timing);
  copy.animate(along.map((progress) => ({ transform: `translateY(${px(shift * (1 - shape(progress)))})` })), timing);
  next.animate(along.map((progress) => ({ opacity: ramp(shape(progress), .2, .72) })), timing);
  if (lifted) {
    const shadow = (alpha: number) => `drop-shadow(0 16px 22px rgb(18 20 14 / ${alpha}%))`;
    box.animate([{ filter: shadow(0) }, { filter: 'var(--delivered-shadow)', offset: .22 }, { filter: 'var(--delivered-shadow)', offset: .7 }, { filter: shadow(0) }], timing);
  }
  const total = seconds * 1000;
  now.element.animate([{ opacity: 0 }, { opacity: 0 }], { duration: Math.max(0, total - HANDOVER) });
  const done = () => {
    box.remove();
    if (!layer.childElementCount) layer.remove();
  };
  box.animate([{ opacity: 1 }, { opacity: 0 }], { id: 'delivered-handover', duration: HANDOVER, delay: Math.max(0, total - HANDOVER), fill: 'forwards' })
    .finished.then(done, done);
}

/** Where the flying boxes are drawn, over the list and moving with it. */
function layerOf(root: HTMLElement) {
  const present = root.querySelector<HTMLElement>(':scope > .delivered-moves');
  if (present) return present;
  const layer = document.createElement('div');
  layer.className = 'delivered-moves';
  root.append(layer);
  return layer;
}

/**
 * Call before the list lets go of the parcels it held in place since they were delivered.
 * When their cards next change place, each one travels from where it stood to the past
 * deliveries, the parcel that becomes Next up grows into its place, and the other blocks
 * glide as they do when a card leaves. Returns a way to call the whole thing off.
 */
export function moveDeliveredCards(root: HTMLElement | null, ids: readonly string[], list: CardList = DELIVERY_CARDS, timeout = 4000): () => void {
  if (!root || typeof MutationObserver === 'undefined') return () => undefined;
  const before = measureList(root, list.blocks);
  const stood = new Map([...cardsIn(root, list)].map(([id, card]) => [id, see(card, before.get(card), list)]));
  const counts = new Map([...root.querySelectorAll<HTMLElement>(COUNT)].map((count) => [count, count.textContent]));
  const touchesCard = (node: Node) => node instanceof HTMLElement && (node.matches(list.card) || Boolean(node.querySelector(list.card)));
  const observer = new MutationObserver((records) => {
    if (!records.some((record) => [...record.addedNodes, ...record.removedNodes].some(touchesCard))) return;
    stop();
    if (!root.animate || reducedMotion()) return;
    const cards = cardsIn(root, list);
    const after = measureList(root, list.blocks);
    // A card that changed kind is another element: the one that was shown has left the page.
    const moves = [...stood].flatMap(([id, was]) => {
      const card = cards.get(id);
      return card && card !== was.element && !was.element.isConnected ? [{ was, now: see(card, after.get(card), list), lifted: ids.includes(id) }] : [];
    });
    // A card that flies is left alone by the glide, and so is the block that only holds it.
    const flown = moves.flatMap(({ now }) => [now.element, ...(list.blocks ? [now.element.closest<HTMLElement>(list.blocks)].filter((block) => block !== null) : [])]);
    glideList(root, before, new Set(flown), list.blocks);
    if (moves.length) {
      const layer = layerOf(root);
      // The arrivals are drawn last, over the card that takes their place.
      for (const { was, now, lifted } of moves.sort((first, second) => Number(first.lifted) - Number(second.lifted))) carry(layer, was, now, lifted, list);
    }
    for (const [count, text] of counts) {
      if (count.isConnected && count.textContent !== text) count.animate([{ scale: 1 }, { scale: 1.22, offset: .45 }, { scale: 1 }], { duration: 360, easing: 'ease-out' });
    }
  });
  const timer = setTimeout(() => stop(), timeout);
  function stop() {
    observer.disconnect();
    clearTimeout(timer);
  }
  observer.observe(root, { childList: true, subtree: true });
  return stop;
}
