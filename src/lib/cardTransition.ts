import { springAt, springSettleTime, type Spring } from './spring';

const PHONE = '(max-width: 760px)';
/** Marks the part of an anchor that the card shows too, such as its map: it stays while the words around it change. */
const PICTURE = 'data-card-picture';
const STILL = '(prefers-reduced-motion: reduce)';
const matches = (query: string) => Boolean(window.matchMedia?.(query).matches);

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
}

/** The tapped card, and where it was when its parcel opened. */
export interface CardOrigin extends Box {
  card: HTMLElement;
}

/** Where a card is on screen, unless it is out of sight. */
function cardBox(card: HTMLElement | null | undefined): Box | null {
  if (!card?.isConnected) return null;
  const bounds = card.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0 || bounds.bottom <= 0 || bounds.top >= window.innerHeight) return null;
  return {
    left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height,
    radius: Number.parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0,
  };
}

/** Capture the actual tapped card, never a stale position from browser history. */
export function captureCardOrigin(card?: HTMLElement): CardOrigin | null {
  if (!card || matches(STILL)) return null;
  const box = cardBox(card);
  return box && { card, ...box };
}

/** How the page is drawn: moved and scaled from its top left corner, then cut to a window with round corners. */
interface Pose extends Look {
  x: number;
  y: number;
  scale: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  radius: number;
}
/** How much of the page shows, and of the words on the part of it that stands in for the card. */
interface Look {
  opacity: number;
  words: number;
}
type Channel = Exclude<keyof Pose, keyof Look>;

const REST: Pose = { x: 0, y: 0, scale: 1, top: 0, right: 0, bottom: 0, left: 0, radius: 0, opacity: 1, words: 1 };
const CHANNELS: readonly Channel[] = ['x', 'y', 'scale', 'top', 'right', 'bottom', 'left', 'radius'];
const WINDOW: readonly Channel[] = ['top', 'right', 'bottom', 'left'];
const OPEN: Spring = { duration: 0.42 };
const CLOSE: Spring = { duration: 0.4 };
const SETTLE: Spring = { duration: 0.36 };
/** Finger travel before a pull begins, as in the list's pull to refresh. */
const SLOP = 8;
/** The corners a pulled page gets, close to a phone screen's own. */
const PULLED_RADIUS = 36;
/** Pixels per second: a faster flick carries the page no further than this would. */
const MAX_SPEED = 3000;

const px = (value: number) => `${Math.round(value * 100) / 100}px`;
/** A spring thrown past its target must not ask for a negative cut or corner, which no browser draws. */
const cut = (value: number) => px(Math.max(0, value));
const fade = (value: number) => ({ opacity: Math.round(value * 1e3) / 1e3 });

function keyframe(pose: Pose): Keyframe {
  return {
    transform: `translate(${px(pose.x)}, ${px(pose.y)}) scale(${Math.round(pose.scale * 1e4) / 1e4})`,
    clipPath: `inset(${cut(pose.top)} ${cut(pose.right)} ${cut(pose.bottom)} ${cut(pose.left)} round ${cut(pose.radius)})`,
    ...fade(pose.opacity),
  };
}

const between = (travel: number, from: number, to: number) => Math.min(1, Math.max(0, (travel - from) / (to - from)));
/*
 * The card and the page say the same things in different places, so their words never show
 * together: the page covers its card within the first steps, then its own words appear.
 */
const arriving = (travel: number): Look => ({ opacity: between(travel, 0, 0.12), words: between(travel, 0.1, 0.35) });
/** On the way back the page's words leave before it lands, and the card's show as the page gives way. */
const landing = (travel: number): Look => ({ opacity: 1 - between(travel, 0.94, 0.985), words: 1 - between(travel, 0.7, 0.9) });

interface Flight {
  /** The page's own animation first, then those of its words. */
  animations: Animation[];
  at: (seconds: number) => Pose;
}

function elapsed({ animations: [animation] }: Flight) {
  // The compositor keeps moving while a long task holds the frame clock, so a running
  // motion is read from the wall clock.
  return (animation.playState === 'running' && typeof animation.startTime === 'number'
    ? Math.max(0, performance.now() - animation.startTime) : Number(animation.currentTime) || 0) / 1000;
}

/** Spring from one pose to another; the browser plays the sampled keyframes. */
function fly(
  page: HTMLElement,
  words: HTMLElement[],
  from: Pose,
  to: Pose,
  { id, spring, speed, look, fill }: {
    id: string;
    spring: Spring;
    /** Pixels per second the page is already moving at. */
    speed?: { x: number; y: number };
    /** What shows for each share of the way, from 0 to 1. */
    look: (travel: number) => Look;
    fill?: FillMode;
  },
): Flight {
  const travel = (seconds: number) => springAt(spring, 0, 1, 0, seconds).value;
  const at = (seconds: number): Pose => {
    const share = travel(seconds);
    const pose = { ...to, ...look(share) };
    for (const key of CHANNELS) pose[key] = from[key] + (to[key] - from[key]) * share;
    if (speed) {
      pose.x = springAt(spring, from.x, to.x, speed.x, seconds).value;
      pose.y = springAt(spring, from.y, to.y, speed.y, seconds).value;
    }
    return pose;
  };
  const reach = Math.max(1, ...WINDOW.map((key) => Math.abs(to[key] - from[key])));
  let seconds = Math.max(
    springSettleTime(spring, from.x, to.x, speed?.x ?? 0),
    springSettleTime(spring, from.y, to.y, speed?.y ?? 0),
    springSettleTime(spring, 0, reach, 0),
    0.12,
  );
  // A page that has faded out has nothing left to show: its motion ends there.
  let exact = true;
  if (look(1).opacity <= 0) {
    for (let early = 0; early < seconds; early += 1 / 120) {
      if (look(travel(early)).opacity > 0) continue;
      seconds = Math.max(early, 0.05);
      exact = false;
      break;
    }
  }
  const steps = Math.max(2, Math.ceil(seconds * 120));
  const poses: Pose[] = [];
  for (let step = 0; step <= steps; step++) poses.push(step === steps && exact ? { ...to, ...look(1) } : at(seconds * step / steps));
  const timing = { duration: seconds * 1000, easing: 'linear', fill };
  const wordFrames = poses.map((pose) => fade(pose.words));
  return {
    animations: [
      page.animate(poses.map(keyframe), { id, ...timing }),
      ...words.map((part) => part.animate(wordFrames, { id: `${id}-words`, ...timing })),
    ],
    at,
  };
}

/** The parts of the page its flight knows. */
interface Parts {
  anchor?: HTMLElement | null;
  header?: HTMLElement | null;
  /** The part whose words change between card and page, where that is not the anchor itself. */
  worded?: HTMLElement | null;
}

/**
 * The page drawn in its card's place. `anchor` is the part of the page that looks like the card:
 * it lands on the card, and nothing else shows. A page scrolled too far for its anchor to fill
 * the card shrinks into the card whole, as it stands.
 */
function poseOnCard(page: HTMLElement, current: Pose, card: Box, { anchor, header, worded }: Parts): { pose: Pose; words: HTMLElement[] } {
  const bounds = page.getBoundingClientRect();
  const zoom = current.scale;
  const width = page.offsetWidth;
  const height = page.offsetHeight;
  let frame = { left: 0, top: 0, width, radius: 0 };
  let words: HTMLElement[] = [];
  const inner = anchor?.getBoundingClientRect();
  if (anchor && inner?.width) {
    // A sticky header covers the top of an anchor that has scrolled under it.
    const top = Math.max(inner.top, header?.getBoundingClientRect().bottom ?? bounds.top);
    const needed = Math.min(inner.height, card.height * inner.width / card.width);
    if (inner.bottom - top >= needed - 1) {
      frame = {
        left: (inner.left - bounds.left) / zoom, top: (top - bounds.top) / zoom, width: inner.width / zoom,
        radius: top > inner.top ? 0 : Number.parseFloat(getComputedStyle(anchor).borderTopLeftRadius) || 0,
      };
      // The anchor's picture carries on from the card's; its words change.
      words = Array.from((worded ?? anchor).children).filter((part): part is HTMLElement => part instanceof HTMLElement && !part.hasAttribute(PICTURE));
    }
  }
  const scale = card.width / frame.width;
  return {
    words,
    pose: {
      x: card.left - (bounds.left - current.x) - frame.left * scale,
      y: card.top - (bounds.top - current.y) - frame.top * scale,
      scale,
      top: frame.top,
      right: Math.max(0, width - frame.left - frame.width),
      bottom: Math.max(0, height - frame.top - card.height / scale),
      left: frame.left,
      // Never squarer than the anchor, whose own corners would otherwise show the page behind them.
      radius: Math.max(card.radius / scale, frame.radius),
      opacity: 0,
      words: 0,
    },
  };
}

/** A colour with its opacity scaled, for the dim behind the page. */
function dimmed(color: string, share: number) {
  const parts = /^rgba?\(([^)]+)\)$/.exec(color)?.[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (!parts || parts.length < 3 || parts.some(Number.isNaN)) return null;
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${Math.round((parts[3] ?? 1) * share * 1e3) / 1e3})`;
}

export interface CardDialog {
  /** Send the page back to its card, then report it closed. */
  close: () => void;
  release: () => void;
}

/**
 * A page that opens out of a card and returns to it. Under a finger, pulling it down from its
 * top or to either side carries it along: let go far or fast enough and it closes.
 */
export function bindCardDialog(page: HTMLElement, options: {
  origin?: CardOrigin | null;
  /** The card to return to, if the page's parcel has one. */
  card: () => HTMLElement | null;
  anchor?: () => HTMLElement | null;
  header?: () => HTMLElement | null;
  worded?: () => HTMLElement | null;
  canPull: () => boolean;
  onClosed: () => void;
}): CardDialog {
  const backdrop = page.parentElement;
  let alive = true;
  let closing = false;
  let pose = REST;
  let flight: Flight | null = null;
  let stopWatching = () => {};
  let touch: { id: number; x: number; y: number; claimed: boolean; side: -1 | 0 | 1; left: number; top: number; width: number; height: number; pull: number; dim: string; samples: { time: number; x: number; y: number }[] } | null = null;
  let suppressClickUntil = 0;

  const parts = (): Parts => ({ anchor: options.anchor?.(), header: options.header?.(), worded: options.worded?.() });
  const now = () => flight ? flight.at(elapsed(flight)) : pose;
  const speedNow = () => {
    if (!flight) return { x: 0, y: 0 };
    const seconds = elapsed(flight);
    const a = flight.at(seconds);
    const b = flight.at(seconds + 1 / 120);
    return { x: (b.x - a.x) * 120, y: (b.y - a.y) * 120 };
  };
  const land = () => {
    flight?.animations.forEach((animation) => animation.cancel());
    flight = null;
    stopWatching();
    stopWatching = () => {};
  };
  const place = (next: Pose) => {
    pose = next;
    const style = keyframe(next);
    page.style.transform = String(style.transform);
    page.style.clipPath = String(style.clipPath);
  };
  const clear = () => {
    pose = REST;
    page.style.transform = '';
    page.style.clipPath = '';
    page.style.willChange = '';
  };

  function open() {
    const origin = options.origin;
    if (!origin || !page.animate || matches(STILL) || !page.offsetWidth) return;
    const start = poseOnCard(page, REST, origin, parts());
    const opening = flight = fly(page, start.words, start.pose, REST, { id: 'parcel-card-expand', spring: OPEN, look: arriving });
    // A turned phone or a keyboard changes what the page grows into.
    const still = window.matchMedia(STILL);
    const stop = () => { if (flight === opening) land(); };
    window.addEventListener('resize', stop);
    window.visualViewport?.addEventListener('resize', stop);
    still.addEventListener('change', stop);
    stopWatching = () => {
      window.removeEventListener('resize', stop);
      window.visualViewport?.removeEventListener('resize', stop);
      still.removeEventListener('change', stop);
    };
    void opening.animations[0].finished.then(stop, stop);
  }

  function fadeDim(to: string | null, duration: number) {
    if (!backdrop?.animate) return;
    const from = getComputedStyle(backdrop).backgroundColor;
    backdrop.animate([{ backgroundColor: from }, { backgroundColor: to ?? dimmed(from, 0) ?? 'transparent' }], {
      duration, easing: 'ease-out', fill: to ? 'none' : 'forwards',
    });
    backdrop.style.backgroundColor = '';
  }

  function close(speed = speedNow()) {
    if (closing) return;
    closing = true;
    touch = null;
    const closed = () => { if (alive) options.onClosed(); };
    if (!page.animate || matches(STILL)) { closed(); return; }
    const from = now();
    const box = cardBox(options.card());
    let leaving: Animation;
    if (box) {
      // Without its flight the page is drawn as `pose` says, which is what gets measured.
      land();
      const end = poseOnCard(page, pose, box, parts());
      // A page caught on its way in leaves with no more than it had shown.
      const look = (travel: number) => {
        const { opacity, words } = landing(travel);
        return { opacity: Math.min(from.opacity, opacity), words: Math.min(from.words, words) };
      };
      [leaving] = fly(page, end.words, from, end.pose, { id: 'detail-card-return', spring: CLOSE, speed, fill: 'forwards', look }).animations;
    } else {
      // No card in sight: a phone's page sinks away, a wide screen's panel leaves sideways
      // from wherever its entrance has brought it.
      const visible = getComputedStyle(page);
      const frames = matches(PHONE)
        ? [keyframe(from), keyframe({ ...from, y: from.y + 36, scale: from.scale * 0.94, radius: Math.max(from.radius, PULLED_RADIUS), opacity: 0 })]
        : [{ opacity: visible.opacity, transform: visible.transform }, { opacity: 0, transform: 'translateX(24px)' }];
      land();
      leaving = page.animate(frames, { duration: 160, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    }
    clear();
    fadeDim(null, Number(leaving.effect?.getComputedTiming().duration) || 160);
    void leaving.finished.catch(() => undefined).then(closed);
  }

  function settle(speed: { x: number; y: number }, dim: string) {
    const settling = flight = fly(page, [], pose, REST, { id: 'detail-pull-settle', spring: SETTLE, speed, look: () => REST });
    clear();
    fadeDim(dim, 220);
    const done = () => { if (flight === settling) flight = null; };
    void settling.animations[0].finished.then(done, done);
  }

  /** A page still on its way in can be pulled once it is all but there. */
  const arrived = () => {
    if (!flight) return true;
    const current = now();
    if (CHANNELS.some((key) => Math.abs(current[key] - REST[key]) > (key === 'scale' ? 0.01 : 4))) return false;
    land();
    return true;
  };

  const touchStart = (event: TouchEvent) => {
    if (touch?.claimed) { touchEnd(event, true); return; }
    touch = null;
    if (event.touches.length !== 1 || closing || !options.canPull()) return;
    if (page.hasAttribute('inert') || !arrived()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('input, textarea, select, [contenteditable], dialog')) return;
    // Nested scrolling surfaces keep their own gestures.
    for (let node: Element | null = target; node && node !== page; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(style.overflowY)) return;
      if (node.scrollWidth > node.clientWidth && /auto|scroll/.test(style.overflowX)) return;
    }
    const point = event.touches[0];
    touch = { id: point.identifier, x: point.clientX, y: point.clientY, claimed: false, side: 0, left: 0, top: 0, width: 0, height: 0, pull: 0, dim: '', samples: [] };
  };

  const touchMove = (event: TouchEvent) => {
    if (!touch) return;
    const point = event.touches[0];
    if (event.touches.length !== 1 || point.identifier !== touch.id) { touchEnd(event, true); return; }
    const dx = point.clientX - touch.x;
    const dy = point.clientY - touch.y;
    if (!touch.claimed) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP) return;
      // Sideways the page can be carried off wherever it is scrolled; downwards only from its top.
      const sideways = Math.abs(dx) > Math.abs(dy) * 1.25;
      const downwards = dy > 0 && Math.abs(dx) <= dy * 0.8 && page.scrollTop <= 0;
      if ((!sideways && !downwards) || !event.cancelable) { touch = null; return; }
      const bounds = page.getBoundingClientRect();
      touch.claimed = true;
      touch.side = sideways ? (dx > 0 ? 1 : -1) : 0;
      touch.left = bounds.left;
      touch.top = bounds.top;
      touch.width = bounds.width;
      touch.height = bounds.height;
      page.style.animation = 'none';
      page.style.willChange = 'transform';
      if (backdrop) {
        backdrop.style.animation = 'none';
        touch.dim = getComputedStyle(backdrop).backgroundColor;
      }
    }
    if (!event.cancelable) { touchEnd(event, true); return; }
    event.preventDefault();
    // Measured from the end of the slop, so the page never jumps when the pull begins.
    const { side } = touch;
    const pull = touch.pull = Math.max(0, (side ? dx * side : dy) - SLOP);
    const share = Math.min(1, pull / (side ? touch.width * 0.9 : touch.height * 0.55));
    const scale = 1 - 0.24 * share;
    // The other way the finger moves counts for less, and not at all until the pull is under way.
    const across = (side ? dy : dx) * 0.7 * Math.min(1, pull / 90);
    // The page shrinks around the finger, which keeps hold of the point it touched.
    const next = {
      ...REST,
      x: (side ? pull * side : across) + (touch.x - touch.left) * (1 - scale),
      y: (side ? across : pull) + (touch.y - touch.top) * (1 - scale),
      scale,
      radius: Math.min(PULLED_RADIUS, pull / 2.5) / scale,
    };
    place(next);
    const lighter = dimmed(touch.dim, 1 - 0.55 * share);
    if (backdrop && lighter) backdrop.style.backgroundColor = lighter;
    touch.samples.push({ time: event.timeStamp, x: next.x, y: next.y });
    if (touch.samples.length > 12) touch.samples.shift();
  };

  /** The finger lifts, or the pull is taken away: by a second finger, the browser or the system. */
  function touchEnd(event: Event, taken = false) {
    const ended = touch;
    touch = null;
    if (!ended?.claimed) return;
    suppressClickUntil = Date.now() + 400;
    // A finger that rested before lifting throws nothing.
    const last = ended.samples.at(-1);
    const moving = last && event.timeStamp - last.time <= 80;
    const first = moving ? ended.samples.find((sample) => last.time - sample.time <= 60) : undefined;
    const span = last && first ? (last.time - first.time) / 1000 : 0;
    const pace = (distance: number) => span > 0 ? Math.max(-MAX_SPEED, Math.min(MAX_SPEED, distance / span)) : 0;
    const speed = last && first ? { x: pace(last.x - first.x), y: pace(last.y - first.y) } : { x: 0, y: 0 };
    // Far enough and not on its way back, or thrown the way it was pulled.
    const along = ended.side ? speed.x * ended.side : speed.y;
    const far = ended.side ? Math.min(120, ended.width * 0.3) : Math.min(150, ended.height * 0.2);
    const away = ended.pull > far ? along > -150 : along > 550 && ended.pull > 18;
    if (away && !taken) close(speed);
    else if (!page.animate || matches(STILL)) {
      clear();
      if (backdrop) backdrop.style.backgroundColor = '';
    } else settle(speed, ended.dim);
  }

  // A pull ends above whatever lay under the finger, which must not take it for a tap.
  const click = (event: MouseEvent) => {
    if (Date.now() >= suppressClickUntil) return;
    event.preventDefault();
    event.stopPropagation();
  };

  page.addEventListener('touchstart', touchStart, { passive: true });
  page.addEventListener('touchmove', touchMove, { passive: false });
  const touchCancel = (event: Event) => touchEnd(event, true);
  page.addEventListener('touchend', touchEnd);
  page.addEventListener('touchcancel', touchCancel);
  page.addEventListener('click', click, true);
  open();

  return {
    close: () => close(),
    release: () => {
      alive = false;
      touch = null;
      land();
      clear();
      page.removeEventListener('touchstart', touchStart);
      page.removeEventListener('touchmove', touchMove);
      page.removeEventListener('touchend', touchEnd);
      page.removeEventListener('touchcancel', touchCancel);
      page.removeEventListener('click', click, true);
    },
  };
}
