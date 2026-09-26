import { leaveList } from './listGlide';
import { springAt, springSettleTime, type Spring } from './spring';

// The archive action's width, as in .parcel-card-swipe__block and __archive.
const ACTION = 88;
const HYSTERESIS = 8;
const RESISTANCE = 0.8;
// Release speeds in px/s: a flick picks open or closed, a throw past the action archives.
const FLICK = 110;
const THROW = 1000;
const MAX_VELOCITY = 3000;
const SNAP: Spring = { duration: 0.3 };
const FLING: Spring = { duration: 0.42, bounce: 0.15 };
const LEAP: Spring = { duration: 0.28 };
const EXIT: Spring = { duration: 0.32 };
const REDUCED: Spring = { duration: 0.24 };

/** How far the card has moved left, whether the action has leapt to its edge, and whether its label has centred. */
type Pose = { reveal: number; spread: number; land: number };
type Motion = { animations: Animation[]; seconds: number; at: (seconds: number) => Pose };

/** The archive commits past the action and at least half the row. */
export function commitPoint(width: number) {
  return Math.max(ACTION + 56, width * 0.5);
}

const rubber = (distance: number, limit: number) => limit * (1 - 1 / (1 + RESISTANCE * distance / limit));
const unrubber = (value: number, limit: number) => value * limit / (RESISTANCE * (limit - value));

/** Finger travel to revealed width: one to one across the action, resisted up to the commit point, softly bounded after. */
export function revealFor(travel: number, width: number) {
  const commit = commitPoint(width);
  const knee = ACTION + (commit - ACTION) / RESISTANCE;
  if (travel < 0) return -rubber(-travel, ACTION / 2);
  if (travel <= ACTION) return travel;
  if (travel <= knee) return ACTION + (travel - ACTION) * RESISTANCE;
  return commit + rubber(travel - knee, width - commit);
}

/** The finger travel that shows `reveal`, so a caught card continues without a jump. */
export function travelFor(reveal: number, width: number) {
  const commit = commitPoint(width);
  if (reveal < 0) return -unrubber(Math.min(-reveal, ACTION / 2 - 0.01), ACTION / 2);
  if (reveal <= ACTION) return reveal;
  if (reveal <= commit) return ACTION + (reveal - ACTION) / RESISTANCE;
  return ACTION + (commit - ACTION) / RESISTANCE + unrubber(Math.min(reveal - commit, width - commit - 0.01), width - commit);
}

/** Settle a released row, projecting its speed the way scrolling momentum would. */
export function releaseSwipe(reveal: number, velocity: number, width: number): 'archive' | 'open' | 'closed' {
  if (reveal >= commitPoint(width) || (reveal >= ACTION && velocity >= THROW)) return 'archive';
  if (Math.abs(velocity) >= FLICK) return velocity > 0 ? 'open' : 'closed';
  return reveal + velocity * 0.5 > ACTION / 2 ? 'open' : 'closed';
}

export interface SwipeRowParts {
  row: HTMLElement;
  card: HTMLElement;
  tray: HTMLElement;
  block: HTMLElement;
  action: HTMLElement;
}

export interface SwipeRow {
  archive: () => void;
  close: () => void;
  /** True when a click on the card ends a swipe instead of opening the parcel. */
  consumeClick: () => boolean;
  destroy: () => void;
}

// Only one row shows its action at a time.
let openRow: SwipeRow | null = null;

/** Swipe left to reveal the archive action; a long swipe or a throw archives. No React render per frame. */
export function bindSwipeRow({ row, card, tray, block, action }: SwipeRowParts, options: {
  reflow: boolean;
  onOpenChange: (open: boolean) => void;
  onArchiveStart: () => void;
  /** Resolves true once the parcel is archived and its row is about to leave. */
  onArchive: () => Promise<boolean>;
}): SwipeRow {
  const parts = [card, tray, block, action];
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let width = 360;
  let pose: Pose = { reveal: 0, spread: 0, land: 0 };
  let phase: 'idle' | 'dragging' | 'settling' | 'archiving' = 'idle';
  let open = false;
  let destroyed = false;
  let motion: Motion | null = null;
  let leap = { from: 0, to: 0, velocity: 0, start: 0 };
  let frame = 0;
  let suppressClickUntil = 0;
  let drag: { id: number; x: number; y: number; grab: number | null; touch: boolean; samples: { time: number; reveal: number }[] } | null = null;

  const px = (value: number) => `${Math.round(value * 100) / 100}px`;
  function transforms({ reveal, spread, land }: Pose) {
    const shown = Math.min(reveal, width);
    const shift = spread * Math.max(0, shown - ACTION);
    return [
      `translateX(${px(-shown)})`,
      // The action rides on the card's edge until it is fully shown.
      `translateX(${px(Math.max(0, ACTION - shown))})`,
      `translateX(${px(-shift)})`,
      `translateX(${px(land * (shift - (width - ACTION) / 2))})`,
    ];
  }
  function render(next: Pose) {
    pose = next;
    transforms(next).forEach((transform, index) => { parts[index].style.transform = transform; });
  }
  function mark(state?: 'dragging' | 'moving' | 'open' | 'archiving') {
    if (state) row.dataset.swipe = state;
    else delete row.dataset.swipe;
  }
  const leapAt = (now: number) => springAt(LEAP, leap.from, leap.to, leap.velocity, Math.max(0, now - leap.start) / 1000);

  function setOpen(next: boolean) {
    if (next === open) return;
    open = next;
    options.onOpenChange(next);
    if (next) document.addEventListener('pointerdown', pressOutside, true);
    else document.removeEventListener('pointerdown', pressOutside, true);
  }
  function pressOutside(event: PointerEvent) {
    if (!(event.target instanceof Node) || !row.contains(event.target)) close();
  }

  /** Freeze any running motion where it is on screen. */
  function stopMotion() {
    const current = motion;
    if (!current) return;
    motion = null;
    // The compositor shows the motion at real time, which can run ahead of the frame's clock.
    const [first] = current.animations;
    const elapsed = (first.startTime !== null ? performance.now() - Number(first.startTime) : Number(first.currentTime ?? 0)) / 1000;
    const now = current.at(Math.min(current.seconds, Math.max(0, elapsed)));
    render(now);
    leap = { from: now.spread, to: now.spread, velocity: 0, start: performance.now() };
    current.animations.forEach((animation) => animation.cancel());
  }

  /**
   * Spring to `target` from the current pose and speed; the compositor plays sampled keyframes.
   * Resolves true when the motion completes, or as soon as `ready` holds on its way.
   */
  function animateTo(target: Pose, velocity: number, spring: Spring, ready?: (pose: Pose) => boolean): Promise<boolean> {
    stopMotion();
    cancelAnimationFrame(frame);
    const now = performance.now();
    const still = reduced();
    const leaping = leapAt(now);
    const start = { ...pose, spread: leaping.value };
    const springs = still ? { reveal: REDUCED, spread: REDUCED, land: REDUCED } : { reveal: spring, spread: LEAP, land: LEAP };
    const speeds = { reveal: still ? 0 : velocity, spread: still ? 0 : leaping.velocity, land: 0 };
    const channel = (key: keyof Pose, seconds: number) => springAt(springs[key], start[key], target[key], speeds[key], seconds).value;
    const at = (seconds: number): Pose => ({ reveal: channel('reveal', seconds), spread: channel('spread', seconds), land: channel('land', seconds) });
    const seconds = Math.max(
      springSettleTime(springs.reveal, start.reveal, target.reveal, speeds.reveal),
      springSettleTime(springs.spread, start.spread, target.spread, speeds.spread, 0.002),
      springSettleTime(springs.land, start.land, target.land, speeds.land, 0.002),
    );
    leap = { from: target.spread, to: target.spread, velocity: 0, start: now };
    if (!card.animate) {
      render(target);
      return Promise.resolve(true);
    }
    const steps = Math.max(2, Math.ceil(seconds * 120));
    const frames = parts.map(() => [] as Keyframe[]);
    for (let step = 0; step <= steps; step++) {
      transforms(step === steps ? target : at(seconds * step / steps))
        .forEach((transform, index) => frames[index].push({ transform }));
    }
    // The inline pose is the end state; the animations only cover the way there.
    render(target);
    const animations = parts.flatMap((part, index) => frames[index].every(({ transform }) => transform === frames[index][0].transform)
      ? [] : [part.animate(frames[index], { duration: seconds * 1000, easing: 'linear' })]);
    if (!animations.length) return Promise.resolve(true);
    const current: Motion = { animations, seconds, at };
    motion = current;
    const finished = animations[0].finished.then(() => {
      if (motion !== current) return false;
      motion = null;
      return true;
    }, () => false);
    let early = 0;
    while (ready && early < seconds && !ready(at(early))) early += 1 / 120;
    if (!ready || early >= seconds) return finished;
    return new Promise((resolve) => setTimeout(() => resolve(motion === current), early * 1000));
  }

  function settle(toOpen: boolean, velocity = 0) {
    setOpen(toOpen);
    delete row.dataset.armed;
    if (!toOpen && openRow === controller) openRow = null;
    phase = 'settling';
    mark('moving');
    void animateTo({ reveal: toOpen ? ACTION : 0, spread: 0, land: 0 }, velocity, toOpen && velocity >= FLICK ? FLING : SNAP).then((finished) => {
      if (!finished || destroyed || phase !== 'settling') return;
      phase = 'idle';
      mark(toOpen ? 'open' : undefined);
    });
  }

  function close() {
    if (phase === 'archiving' || phase === 'dragging' || (!open && pose.reveal === 0)) return;
    settle(false);
  }

  async function archive(velocity = 0) {
    if (phase === 'archiving' || destroyed) return;
    phase = 'archiving';
    mark('archiving');
    width = card.offsetWidth || width;
    setOpen(false);
    if (openRow === controller) openRow = null;
    row.dataset.armed = '';
    options.onArchiveStart();
    // The row starts leaving once the card is out of sight and the label has nearly centred.
    await animateTo({ reveal: width, spread: 1, land: 1 }, Math.max(0, velocity), EXIT,
      ({ reveal, land }) => reveal >= width - 2 && land >= 0.92);
    if (destroyed) return;
    const leaving = leaveList(row, options.reflow);
    await leaving.faded;
    if (destroyed || await options.onArchive() || destroyed) return;
    // The parcel stayed: bring its row back.
    leaving.restore();
    delete row.dataset.armed;
    phase = 'settling';
    mark('moving');
    if (await animateTo({ reveal: 0, spread: 0, land: 0 }, 0, SNAP) && !destroyed && phase === 'settling') {
      phase = 'idle';
      mark();
    }
  }

  function arm(armed: boolean, now: number) {
    const target = armed ? 1 : 0;
    if (leap.to === target) return;
    const current = leapAt(now);
    leap = { from: current.value, to: target, velocity: current.velocity, start: now };
    if (reduced()) leap = { from: leap.to, to: leap.to, velocity: 0, start: now };
    if (armed) {
      row.dataset.armed = '';
      // Chrome blocks vibration until the page has been tapped once.
      if (drag?.touch && navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(8);
    } else delete row.dataset.armed;
    const step = (time: number) => {
      if (phase !== 'dragging') return;
      const state = leapAt(time);
      render({ ...pose, spread: state.value });
      if (Math.abs(state.value - leap.to) > 0.001 || Math.abs(state.velocity) > 0.01) frame = requestAnimationFrame(step);
    };
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(step);
  }

  function velocityAt(samples: { time: number; reveal: number }[], time: number) {
    const recent = samples.filter((sample) => time - sample.time <= 100);
    if (recent.length < 2) return 0;
    const first = recent[0];
    const last = recent[recent.length - 1];
    if (last.time - first.time < 8) return 0;
    const velocity = (last.reveal - first.reveal) / (last.time - first.time) * 1000;
    return Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, velocity));
  }

  function listen(on: boolean) {
    for (const [type, handler] of [['pointermove', pointerMove], ['pointerup', pointerUp], ['pointercancel', pointerCancel]] as const) {
      if (on) window.addEventListener(type, handler);
      else window.removeEventListener(type, handler);
    }
  }
  function pointerDown(event: PointerEvent) {
    if (destroyed || phase === 'archiving' || drag || event.isPrimary === false || event.button > 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, grab: null, touch: event.pointerType !== 'mouse', samples: [] };
    listen(true);
  }
  function pointerMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (drag.grab === null) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < HYSTERESIS) return;
      if (Math.abs(dx) <= Math.abs(dy) * 1.25) {
        // A vertical gesture belongs to the page.
        drag = null;
        listen(false);
        return;
      }
      if (openRow && openRow !== controller) openRow.close();
      openRow = controller;
      width = card.offsetWidth || width;
      stopMotion();
      // Pick the card up where it is, from the point where the drag began.
      drag.grab = travelFor(pose.reveal, width) + drag.x + Math.sign(dx) * HYSTERESIS;
      try { card.setPointerCapture(event.pointerId); } catch { /* Synthetic pointers cannot be captured. */ }
      phase = 'dragging';
      mark('dragging');
    }
    event.preventDefault();
    const reveal = revealFor(drag.grab - event.clientX, width);
    drag.samples.push({ time: event.timeStamp, reveal });
    if (drag.samples.length > 12) drag.samples.shift();
    const now = performance.now();
    arm(reveal >= commitPoint(width), now);
    render({ reveal, spread: leapAt(now).value, land: 0 });
  }
  function pointerUp(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    const ended = drag;
    drag = null;
    listen(false);
    if (ended.grab === null) return;
    try { card.releasePointerCapture(event.pointerId); } catch { /* Already released. */ }
    suppressClickUntil = performance.now() + 400;
    const velocity = velocityAt(ended.samples, event.timeStamp);
    const decision = releaseSwipe(pose.reveal, velocity, width);
    if (decision === 'archive') void archive(velocity);
    else settle(decision === 'open', velocity);
  }
  function pointerCancel(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    const ended = drag;
    drag = null;
    listen(false);
    if (ended.grab !== null) settle(pose.reveal > ACTION / 2);
  }

  const controller: SwipeRow = {
    archive: () => void archive(),
    close,
    consumeClick() {
      if (performance.now() < suppressClickUntil) {
        suppressClickUntil = 0;
        return true;
      }
      if (phase === 'archiving') return true;
      if (!open && pose.reveal === 0) return false;
      settle(false);
      return true;
    },
    destroy() {
      destroyed = true;
      listen(false);
      document.removeEventListener('pointerdown', pressOutside, true);
      cancelAnimationFrame(frame);
      motion?.animations.forEach((animation) => animation.cancel());
      motion = null;
      card.removeEventListener('pointerdown', pointerDown);
      if (openRow === controller) openRow = null;
    },
  };
  card.addEventListener('pointerdown', pointerDown);
  render(pose);
  return controller;
}
