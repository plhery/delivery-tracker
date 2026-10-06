import { DELIVERY_CARDS, type CardList } from './deliveredMove';

/** More paper from the large card than from a row of the list. */
const PIECES = { next: 58, other: 38 };
const GLINTS = 6;
const GLINT = 'M0-7C.9-2 2-.9 7 0 2 .9 .9 2 0 7-.9 2-2 .9-7 0-2-.9-.9-2 0-7Z';
/** What the paper's colours are made of, read from the card it comes out of. */
const TONES = ['--tone', '--tone-surface', '--carrier-brand', '--yellow'];
/** The card's ink, its carrier's colour and the app's yellow, with a lighter and a deeper mix, and white. */
const PAPER = [
  'var(--tone)', 'var(--carrier-brand)', 'var(--yellow)', 'var(--yellow)',
  'color-mix(in srgb, var(--tone) 55%, var(--tone-surface))', 'light-dark(#fff, #f5f6f2)',
  'color-mix(in srgb, var(--yellow) 30%, var(--tone))',
];

const px = (value: number) => `${Math.round(value * 10) / 10}px`;

/** Numbers from 0 to 1 that follow from a seed, so a burst can be told in advance. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = state + 0x6D2B79F5 | 0;
    let mixed = Math.imul(state ^ state >>> 15, 1 | state);
    mixed = mixed + Math.imul(mixed ^ mixed >>> 7, 61 | mixed) ^ mixed;
    return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
  };
}

/** Where the paper comes out of a card: Pip's open box, else where the parcel's route ends, else its stamp. */
function mouth(card: HTMLElement) {
  const pip = card.querySelector('[data-pip] svg')?.getBoundingClientRect();
  if (pip?.width) return { x: pip.left + pip.width / 2, y: pip.top + pip.height * .38 };
  const end = (card.querySelector('g[data-kind="current"]') ?? card.querySelector('.parcel-stamp'))?.getBoundingClientRect();
  return end?.width ? { x: end.left + end.width / 2, y: end.top + end.height / 2 } : null;
}

/** The first of these cards whose paper would be seen. */
function source(root: HTMLElement, ids: readonly string[], list: CardList) {
  for (const card of root.querySelectorAll<HTMLElement>(`${list.card}[data-arrived]`)) {
    if (!ids.includes(card.getAttribute(list.id) ?? '')) continue;
    const from = mouth(card);
    if (from && from.x >= 0 && from.x <= window.innerWidth && from.y >= 0 && from.y <= window.innerHeight) return { card, from };
  }
  return null;
}

/** A piece of paper: a sharp pop against the air, then a tumbling fall. */
function piece(next: () => number, x: number, y: number) {
  const bit = document.createElement('i');
  const kind = next();
  const width = kind < .18 ? 5 + next() * 4 : kind < .36 ? 3 : 5 + next() * 6;
  const height = kind < .18 ? width : kind < .36 ? 11 + next() * 7 : width * (1.25 + next() * .8);
  Object.assign(bit.style, {
    width: px(width), height: px(height), marginLeft: px(-width / 2), marginTop: px(-height / 2),
    background: PAPER[Math.floor(next() * PAPER.length)], borderRadius: kind < .18 ? '50%' : '1.5px',
  });
  const angle = (-90 + (next() - .5) * 140) * Math.PI / 180;
  const speed = 430 + next() * 740;
  const drag = 2.5 + next() * 1.1;
  const terminal = 980 / drag;
  const life = 1.5 + next() * .8;
  const spin = (next() - .5) * 1500;
  const tumble = 7 + next() * 11;
  const sway = 5 + next() * 15;
  const beat = 3 + next() * 4;
  const phase = next() * 6.28;
  const steps = Math.ceil(life * 45);
  const frames = Array.from({ length: steps + 1 }, (_, step) => {
    const time = life * step / steps;
    const slowed = 1 - Math.exp(-drag * time);
    const left = x + speed * Math.cos(angle) / drag * slowed + sway * Math.sin(beat * time + phase) * Math.min(1, time / .5);
    const top = y + terminal * time + (speed * Math.sin(angle) - terminal) / drag * slowed;
    const turn = spin * (1 - Math.exp(-1.3 * time)) / 1.3;
    return {
      transform: `translate(${px(left)}, ${px(top)}) rotate(${Math.round(turn)}deg) scaleY(${Math.cos(tumble * time + phase).toFixed(3)})`,
      opacity: Math.min(1, time / .04, (1 - step / steps) / .3),
    };
  });
  return { element: bit, frames, timing: { duration: life * 1000, delay: next() * 70, fill: 'both' as const } };
}

/** A glint that flies out a little way and goes. */
function glint(next: () => number, x: number, y: number, index: number) {
  const size = 9 + next() * 9;
  const angle = (-90 + (index / (GLINTS - 1) - .5) * 190 + (next() - .5) * 18) * Math.PI / 180;
  const reach = 30 + next() * 34;
  const star = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  star.setAttribute('viewBox', '-7 -7 14 14');
  Object.assign(star.style, { width: px(size), height: px(size), marginLeft: px(-size / 2), marginTop: px(-size / 2) });
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', GLINT);
  path.style.fill = index % 3 === 1 ? 'var(--yellow)' : 'var(--tone)';
  star.append(path);
  const at = (part: number) => `translate(${px(x + Math.cos(angle) * reach * part)}, ${px(y + Math.sin(angle) * reach * part)})`;
  const frames = [
    { transform: `${at(0)} scale(0) rotate(0deg)`, opacity: 0 },
    { transform: `${at(.7)} scale(1.1) rotate(50deg)`, opacity: 1, offset: .45 },
    { transform: `${at(1)} scale(0) rotate(110deg)`, opacity: 0 },
  ];
  return { element: star, frames, timing: { duration: 520 + next() * 180, delay: next() * 80, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' as const } };
}

/**
 * Paper thrown for the parcels that have just arrived: out of Pip's open box on the first of their cards that
 * is on screen, in that card's colours. One burst, however many arrived, over the whole screen and never in
 * the way of a finger; none where nothing moves. Returns a way to clear it.
 */
export function throwConfetti(root: HTMLElement | null, ids: readonly string[], list: CardList = DELIVERY_CARDS, seed = Date.now()): () => void {
  const none = () => undefined;
  if (!root || typeof root.animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return none;
  const found = source(root, ids, list);
  if (!found) return none;
  const { card, from } = found;
  const layer = document.createElement('div');
  layer.className = 'delivered-confetti';
  layer.setAttribute('aria-hidden', 'true');
  // Over the whole screen, and never in the way of a finger.
  Object.assign(layer.style, { position: 'fixed', inset: '0', zIndex: '120', overflow: 'clip', pointerEvents: 'none', contain: 'strict' });
  // The paper flies outside the card, so it takes the card's colours with it.
  const look = getComputedStyle(card);
  for (const name of TONES) layer.style.setProperty(name, look.getPropertyValue(name));
  layer.style.colorScheme = look.colorScheme;
  const next = random(seed);
  const count = card.matches(list.large) ? PIECES.next : PIECES.other;
  const thrown = [
    ...Array.from({ length: count }, () => piece(next, from.x, from.y)),
    ...Array.from({ length: GLINTS }, (_, index) => glint(next, from.x, from.y, index)),
  ];
  for (const { element } of thrown) Object.assign(element.style, { position: 'absolute', left: '0', top: '0', willChange: 'transform, opacity' });
  layer.append(...thrown.map(({ element }) => element));
  document.body.append(layer);
  void Promise.allSettled(thrown.map(({ element, frames, timing }) => element.animate(frames, timing).finished)).then(() => layer.remove());
  return () => layer.remove();
}
