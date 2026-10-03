// Where Pip stands on a map and what he covers there, without his drawing: the map's layout needs no more of him.
import type { Stage } from '../../types';

/** How Pip, the parcel with a face, feels about the parcel's stage. */
export type PipMood = 'look' | 'eager' | 'wait' | 'worry' | 'joy';
/** Which side of Pip the parcel's dot is on: -1 to his left, 1 to his right, 0 straight above or below. */
export type PipSide = -1 | 0 | 1;

export function pipMood(stage?: Stage): PipMood | null {
  switch (stage) {
    case 'registered': case 'accepted': case 'in_transit': return 'look';
    case 'out_for_delivery': return 'eager';
    case 'customs': case 'ready_for_pickup': return 'wait';
    case 'failed_attempt': case 'exception': case 'returned': return 'worry';
    case 'delivered': return 'joy';
    default: return null;
  }
}

/** Pip is drawn in the parcel's 300 × 310 frame and stands on this point of it. */
export const PIP_FRAME = { width: 300, height: 310, groundX: 150, groundY: 282 };
/** How far an eager Pip is lifted off the ground, in frame units. */
export const EAGER_LIFT = 16;
/** Widths to try, largest first: he is bigger when the parcel has arrived, unless only a small Pip fits. */
export const pipWidths = (mood: PipMood): readonly number[] => mood === 'joy' ? [66, 62, 54, 48] : [48, 44];
/** Where Pip may stand: his ground point, as offsets from the dot in Pip widths, best first. */
export const PIP_SPOTS: readonly (readonly [number, number])[] = [[.66, .32], [-.66, .32], [.62, -.02], [-.62, -.02], [.4, .78], [-.4, .78], [0, -.26]];
/** The last resort, straight below the dot: for a dot at the frame's edge, with its route and its name on the open sides. */
export const PIP_SPOT_BELOW: readonly [number, number] = [0, 1.08];

type Extents = { left: number; top: number; right: number; bottom: number };
type Outline = readonly (readonly [number, number])[];
const BOX: Outline = [[55, 142], [150, 95], [245, 142], [245, 229], [150, 277], [55, 229]];
const OPEN_BOX: Outline = [[17, 95], [91, 45], [151, 24], [216, 46], [274, 92], [280, 183], [245, 229], [150, 277], [55, 229], [27, 186]];
const SPEED_LINES: Extents = { left: 0, top: 166, right: 44, bottom: 226 };

/** The frame's box that holds Pip: the box itself, its open flaps, or the speed lines trailing away from the dot. */
export function pipExtents(mood: PipMood, side: PipSide): Extents {
  // The open flaps reach a little further than the box they are hinged on.
  if (mood === 'joy') return { left: 17, top: 24, right: 280, bottom: 288 };
  if (mood === 'eager') return { left: side < 0 ? 52 : 0, top: 92 - EAGER_LIFT, right: side < 0 ? PIP_FRAME.width : 248, bottom: 288 };
  return { left: 52, top: 92, right: 248, bottom: 288 };
}

/** What Pip actually covers, as convex outlines in the frame: the corners of his box are empty. */
export function pipOutlines(mood: PipMood, side: PipSide): Outline[] {
  if (mood === 'joy') return [OPEN_BOX];
  if (mood !== 'eager') return [BOX];
  const { left, top, right, bottom } = SPEED_LINES;
  const lines: Outline = [[left, top], [right, top], [right, bottom], [left, bottom]];
  return [BOX.map(([x, y]) => [x, y - EAGER_LIFT] as const), side < 0 ? lines.map(([x, y]) => [PIP_FRAME.width - x, y] as const) : lines];
}

/** How far a point is from a convex outline: 0 inside it. */
export function outlineDistance([x, y]: readonly [number, number], outline: Outline): number {
  let nearest = Infinity;
  let turns = 0;
  outline.forEach(([ax, ay], index) => {
    const [bx, by] = outline[(index + 1) % outline.length];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    turns += Math.sign(cross);
    const along = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
    nearest = Math.min(nearest, Math.hypot(x - ax - along * (bx - ax), y - ay - along * (by - ay)));
  });
  // Inside, every edge turns the same way.
  return Math.abs(turns) === outline.length ? 0 : nearest;
}
