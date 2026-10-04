// What a map shows and where everything on it goes, worked out without a browser: the canvas map draws from it, and so does the server.
import { geoDistance, geoInterpolate, geoPath } from 'd3-geo';
import { fitCamera, projection, type Box, type Camera } from './camera';
import { PIP_FRAME, PIP_SPOTS, PIP_SPOT_BELOW, outlineDistance, pipExtents, pipOutlines, pipWidths, type PipMood, type PipSide } from './pipGeometry';
import { NEAR_KM, distanceKm, formatKm, placeName, type MapMode, type Route, type Scale } from './route';
import { cities, geography, type Coordinate, type Detail, type Part } from './world';

export interface Insets { top: number; right: number; bottom: number; left: number }
export interface PipPlacing {
  mood: PipMood;
  /** Where the card's top row ends; the top inset when absent. */
  ceiling?: number;
  /** Where the card starts writing over the bottom of the map; the map's bottom edge when absent. */
  floor?: number;
}
export type Size = { width: number; height: number };
export type Shape = 'rect' | 'circle';

const MIN_SPAN: Record<Scale, number> = { world: 400, region: 300, local: 120, city: 24, point: 260, none: 0 };
// A town is named once, however many of its sites the parcel passed through.
const SAME_TOWN_KM = 30;
// With nothing to show yet, the globe rests on the parcel's likely destination.
const RESTING_CENTER: Coordinate = [8.2, 42];

/** A round map sits in the middle of its box, inset so rim pointers fit. */
export function circleOf(size: Size, insets: Insets) {
  const width = size.width - insets.left - insets.right;
  const height = size.height - insets.top - insets.bottom;
  return { x: insets.left + width / 2, y: insets.top + height / 2, radius: Math.min(width, height) / 2 };
}

export function targetCamera(route: Route, mode: MapMode, size: Size, insets: Insets, shape: Shape): Camera {
  let box: Box;
  if (shape === 'circle') {
    const { x, y, radius } = circleOf(size, insets);
    const inner = radius * .87;
    box = { x: x - inner, y: y - inner, width: inner * 2, height: inner * 2 };
  } else {
    const inner = Math.min(size.width - insets.left - insets.right, size.height - insets.top - insets.bottom);
    const pad = Math.min(40, inner * .12);
    box = {
      x: insets.left + pad,
      y: insets.top + pad,
      width: Math.max(size.width - insets.left - insets.right - pad * 2, 40),
      height: Math.max(size.height - insets.top - insets.bottom - pad * 2, 40),
    };
  }
  const current = route.current?.place.coordinate;
  const destination = route.destination?.coordinate;
  if (mode === 'now' && current) {
    const points = [...route.near.map(stop => stop.place.coordinate)];
    if (destination && distanceKm(destination, current) < NEAR_KM) points.push(destination);
    // Like the journey below, a close-up of countries is no town-sized window on their label points.
    const countriesOnly = route.near.every((stop) => stop.place.precision === 'country');
    return fitCamera(points, box, { shape, minSpanKm: countriesOnly ? 1500 : 260 });
  }
  const ends = [...route.stops.map(stop => stop.place.coordinate), ...(destination ? [destination] : [])];
  // Frame the arcs as well as their ends, so a bowed route never leaves the view.
  const arcs = [...route.legs.map(leg => [leg.from.place.coordinate, leg.to.place.coordinate, leg.km] as const),
    ...(current && destination ? [[current, destination, route.remainingKm ?? 0] as const] : [])]
    .filter(([, , km]) => km > 300)
    .flatMap(([from, to]) => [.25, .5, .75].map(t => geoInterpolate(from, to)(t) as Coordinate));
  // A route of countries only frames the countries, not a town-sized window on their label points.
  const countriesOnly = route.stops.length > 0 && route.stops.every((stop) => stop.place.precision === 'country');
  const minSpanKm = countriesOnly ? Math.max(MIN_SPAN[route.scale], 1500) : MIN_SPAN[route.scale];
  const camera = ends.length
    ? fitCamera([...ends, ...arcs], box, { shape, minSpanKm, tilt: route.scale === 'world' })
    : fitCamera([RESTING_CENTER], box, { shape, minSpanKm: 1e5, globeAbove: -1 });
  if (shape === 'circle') {
    // A round window shows either the whole globe or a close-up, never a globe inside a circle.
    const circle = circleOf(size, insets);
    if (camera.scale < circle.radius * 1.3) return { center: camera.center, scale: circle.radius, offset: [circle.x, circle.y] };
  }
  return camera;
}

/** What a camera shows of the world: how fine its shapes are, which of them can be seen, and how much of a globe it is. */
export function mapView(camera: Camera, size: Size) {
  const span = Math.min(size.width, size.height) / camera.scale;
  const detail: Detail = span < .45 ? 'fine' : 'coarse';
  // Only shapes whose cap reaches the view: a close-up draws a few countries, not all of them.
  const reach = Math.max(...[[0, 0], [size.width, 0], [0, size.height], [size.width, size.height]]
    .map(([x, y]) => Math.hypot(x - camera.offset[0], y - camera.offset[1]))) / camera.scale;
  const angle = reach >= 1 ? Math.PI / 2 : Math.asin(reach) + .02;
  return {
    detail,
    inView: <T>(parts: readonly Part<T>[]) => parts.filter(item => geoDistance(item.center, camera.center) - item.radius < angle)
      .map(item => item.shape),
    /** 0 in a close-up, 1 once the curve of the Earth shows. */
    globe: Math.max(0, Math.min(1, (span - .5) / .9)),
    /** How strongly the countries the parcel passed through are tinted: only once the view is wide enough to hold several. */
    visited: Math.max(0, Math.min(1, (span * 6371 - 800) / 1600)),
  };
}

export interface Overlay {
  /**
   * `pen` is a leg's turn in the one stroke that draws the route from its first place to the parcel's: when the turn
   * starts and how long it lasts, as shares of the whole stroke, and how much of the leg is left to draw once it enters
   * the frame. The way still to go has no turn.
   */
  legs: { id: string; d: string; kind: 'travelled' | 'approximate' | 'remaining'; pen?: { from: number; share: number; reach: number } }[];
  /** How far the stroke runs in the frame, in pixels. */
  stroke: number;
  dots: { id: string; x: number; y: number; kind: 'origin' | 'stop' | 'current' | 'last-known' | 'area' | 'destination' }[];
  /** Each name with the corner and the width of the box it found room for. */
  labels: { id: string; x: number; y: number; width: number; text: string; kind: 'current' | 'end' | 'stop' | 'area' | 'context' | 'city' }[];
  pointers: { id: string; x: number; y: number; angle: number; text: string; detail: string }[];
  /** Where Pip's frame starts, how wide it is, and which side of him the parcel's dot is on. */
  pip: { x: number; y: number; width: number; mood: PipMood; side: PipSide; below: boolean } | null;
}

type Rect = { x: number; y: number; width: number; height: number };
/** A hop is drawn whole, however far outside the frame it starts. */
const UNCUT: Rect = { x: -1e9, y: -1e9, width: 2e9, height: 2e9 };
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** How far a line runs before it first enters a box, and how far it runs inside it. */
function runThrough(track: readonly (readonly [number, number])[], box: Rect): { before: number; inside: number } {
  let before = 0;
  let inside = 0;
  for (let index = 1; index < track.length; index += 1) {
    const [x1, y1] = track[index - 1];
    const [x2, y2] = track[index];
    const length = Math.hypot(x2 - x1, y2 - y1);
    // Where this step enters and leaves the box, as shares of the step.
    let enter = 0;
    let leave = 1;
    for (const [delta, low, high] of [[x2 - x1, box.x - x1, box.x + box.width - x1], [y2 - y1, box.y - y1, box.y + box.height - y1]]) {
      if (delta === 0) {
        if (low > 0 || high < 0) leave = -1;
      } else {
        enter = Math.max(enter, Math.min(low / delta, high / delta));
        leave = Math.min(leave, Math.max(low / delta, high / delta));
      }
    }
    const within = leave > enter ? (leave - enter) * length : 0;
    if (!inside) before += within ? enter * length : length;
    inside += within;
  }
  return { before, inside };
}

/**
 * The route's legs, its dots, the names that find room and where Pip stands. `textWidth` measures a name in the
 * face the map writes it in.
 */
export function layout(route: Route, camera: Camera, size: Size, insets: Insets, shape: Shape, labels: 'all' | 'ends' | 'none', sites: boolean,
  mode: MapMode, context: boolean, languageTag: string, pip: PipPlacing | null, textWidth: (text: string) => number): Overlay {
  // Long legs are cut a little outside the frame.
  const cut: Rect = { x: -400, y: -400, width: size.width + 800, height: size.height + 800 };
  const project = projection(camera).clipExtent([[cut.x, cut.y], [cut.x + cut.width, cut.y + cut.height]]);
  const svgPath = geoPath(project);
  const visible = (point: Coordinate) => geoDistance(point, camera.center) < Math.PI / 2 - .02;
  const at = (point: Coordinate) => project(point) ?? [0, 0];
  const { x: centerX, y: centerY, radius } = circleOf(size, insets);
  const inside = ([x, y]: readonly [number, number], margin = 0) => shape === 'circle'
    ? Math.hypot(x - centerX, y - centerY) < radius - margin
    : x > insets.left + margin && x < size.width - insets.right - margin && y > insets.top + margin && y < size.height - insets.bottom - margin;

  // A leg as it is drawn, with the box its line is cut to, and sampled along its curve so names and Pip can keep off it.
  const tracks: [number, number][][] = [];
  const frame: Rect = shape === 'circle' ? { x: centerX - radius, y: centerY - radius, width: radius * 2, height: radius * 2 }
    : { x: 0, y: 0, width: size.width, height: size.height };
  const legPath = (a: Coordinate, b: Coordinate, km: number): { d: string; drawn: Rect } => {
    if (km < 900 && visible(a) && visible(b)) {
      // Short hops bow slightly to the left of travel: a hop, not a road.
      const [x1, y1] = at(a);
      const [x2, y2] = at(b);
      const length = Math.hypot(x2 - x1, y2 - y1) || 1;
      const bend = Math.min(length * .18, 70);
      const cx = (x1 + x2) / 2 + (y2 - y1) / length * bend;
      const cy = (y1 + y2) / 2 - (x2 - x1) / length * bend;
      const steps = Math.max(8, Math.ceil(length / 3));
      tracks.push(Array.from({ length: steps + 1 }, (_, index) => {
        const t = index / steps;
        return [(1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2, (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2];
      }));
      return { d: `M${x1.toFixed(1)},${y1.toFixed(1)}Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`, drawn: UNCUT };
    }
    const along = geoInterpolate(a, b);
    tracks.push(Array.from({ length: 121 }, (_, index) => along(index / 120) as Coordinate).filter(visible).map(point => at(point) as [number, number]));
    return { d: svgPath({ type: 'LineString', coordinates: [a, b] }) ?? '', drawn: cut };
  };

  // The stroke spends its time where it can be seen: a leg's turn lasts as long as its run through the frame, and starts
  // where it enters the frame, so a close-up never waits for a line that is still far outside it.
  const runs = route.legs.map((leg) => {
    const { d, drawn } = legPath(leg.from.place.coordinate, leg.to.place.coordinate, leg.km);
    const track = tracks[tracks.length - 1];
    const line = runThrough(track, drawn);
    const seen = runThrough(track, frame);
    const hidden = line.inside > 0 ? Math.max(0, Math.min(1, (seen.before - line.before) / line.inside)) : 1;
    return { d, seen: seen.inside, reach: seen.inside > 0 ? 1 - hidden : 0 };
  });
  const stroke = runs.reduce((sum, run) => sum + run.seen, 0);
  // Every leg takes a moment, however short: a turn of no length cannot be told as a share.
  const turns = runs.map(run => Math.max(run.seen, Math.max(stroke, 1) * .005));
  const whole = turns.reduce((sum, turn) => sum + turn, 0);
  let from = 0;
  const legs: Overlay['legs'] = route.legs.map((leg, index) => {
    const pen = { from, share: turns[index] / whole, reach: runs[index].reach };
    from += pen.share;
    return {
      id: leg.id,
      d: runs[index].d,
      kind: leg.from.place.precision === 'country' || leg.to.place.precision === 'country' ? 'approximate' : 'travelled',
      pen,
    };
  });
  if (route.current && route.destination) legs.unshift({
    id: `remaining-${route.destination.id}`,
    d: legPath(route.current.place.coordinate, route.destination.coordinate, route.remainingKm ?? 0).d,
    kind: 'remaining',
  });
  /** Whether a leg passes through a box. */
  const onRoute = (box: Rect) => tracks.some(track => track.some(([x, y]) => x > box.x - 1 && x < box.x + box.width + 1
    && y > box.y - 1 && y < box.y + box.height + 1));

  const dots: Overlay['dots'] = [];
  route.stops.forEach((stop, index) => {
    const point = stop.place.coordinate;
    if (!visible(point)) return;
    const [x, y] = at(point);
    const last = index === route.stops.length - 1;
    const kind = last ? (route.latestLocated ? 'current' : 'last-known')
      : stop.place.precision === 'country' ? 'area'
        : index === 0 ? 'origin' : 'stop';
    dots.push({ id: stop.id, x, y, kind: last && stop.place.precision === 'country' && !route.latestLocated ? 'area' : kind });
  });
  if (route.destination && visible(route.destination.coordinate)) {
    const [x, y] = at(route.destination.coordinate);
    dots.unshift({ id: 'destination', x, y, kind: 'destination' });
  }

  // Place names, most important first, skipping any that would collide.
  const placed: Rect[] = dots.map(dot => ({ x: dot.x - 6, y: dot.y - 6, width: 12, height: 12 }));
  const overlaps = (box: Rect) => placed.some(other => intersects(box, other));
  const candidates = [
    ...(route.current ? [{ id: route.current.id, place: route.current.place, kind: 'current' as const, priority: 0 }] : []),
    ...(route.destination ? [{ id: 'destination', place: route.destination, kind: 'end' as const, priority: 1 }] : []),
    ...(route.origin && route.origin !== route.current ? [{ id: route.origin.id, place: route.origin.place, kind: 'end' as const, priority: 2 }] : []),
    ...route.stops.slice(1, -1).map(stop => ({ id: stop.id, place: stop.place, kind: 'stop' as const, priority: 3 })),
  ].filter(candidate => labels === 'all' || (labels === 'ends' && candidate.priority < 3));
  const neighbours = new Map<string, Coordinate[]>(route.stops.map((stop, index) => [stop.id,
    [route.stops[index - 1], route.stops[index + 1]].flatMap(other => other ? [other.place.coordinate] : [])]));
  if (route.current && route.destination) {
    neighbours.get(route.current.id)?.push(route.destination.coordinate);
    neighbours.set('destination', [route.current.place.coordinate]);
  }
  const legDirection = (id: string, x: number, y: number) => {
    let dx = 0;
    let dy = 0;
    for (const other of neighbours.get(id) ?? []) {
      if (!visible(other)) continue;
      const [ox, oy] = at(other);
      const length = Math.hypot(ox - x, oy - y) || 1;
      dx += (ox - x) / length;
      dy += (oy - y) / length;
    }
    return [dx, dy] as const;
  };
  /** Where a place's name goes among the marks already taken, and whether that spot is clear of all of them and of the route. */
  const nameBox = (candidate: typeof candidates[number], taken: Rect[]) => {
    const [x, y] = at(candidate.place.coordinate);
    const area = candidate.place.precision === 'country';
    const text = area ? candidate.place.name.toUpperCase() : placeName(candidate.place, sites);
    const width = area ? textWidth(text) * .91 + text.length * .84 + 10 : textWidth(text) + 14;
    const height = 22;
    const [awayX, awayY] = legDirection(candidate.id, x, y);
    const ranked = (sides: { x: number; y: number; dx: number; dy: number }[]) => sides
      .map((option, index) => ({ x: option.x, y: option.y, width, height, order: option.dx * awayX + option.dy * awayY + index * .01 }))
      .sort((a, b) => a.order - b.order);
    // Beside, above or below the dot first; a town's name may also sit off one of its corners.
    const options = area
      ? ranked([{ x: x - width / 2, y: y + 8, dx: 0, dy: 1 }, { x: x - width / 2, y: y - 30, dx: 0, dy: -1 },
        { x: x + 8, y: y + 6, dx: 1, dy: 1 }, { x: x - width - 8, y: y + 6, dx: -1, dy: 1 }])
      : [...ranked([{ x: x + 9, y: y - height / 2, dx: 1, dy: 0 }, { x: x - 9 - width, y: y - height / 2, dx: -1, dy: 0 },
        { x: x - width / 2, y: y - 29, dx: 0, dy: -1 }, { x: x - width / 2, y: y + 8, dx: 0, dy: 1 }]),
      ...ranked([{ x: x + 8, y: y + 6, dx: 1, dy: 1 }, { x: x - width - 8, y: y + 6, dx: -1, dy: 1 },
        { x: x + 8, y: y - height - 6, dx: 1, dy: -1 }, { x: x - width - 8, y: y - height - 6, dx: -1, dy: -1 }])];
    const fits = (option: Rect) => inside([option.x, option.y], 2) && inside([option.x + width, option.y + height], 2)
      && inside([option.x + width, option.y], 2) && inside([option.x, option.y + height], 2);
    const free = (option: Rect) => !taken.some(other => intersects(option, other));
    const inFrame = options.filter(fits);
    // The parcel's own place is always named: moved in from the frame's edge rather than cut off by it, and over another mark if it must be.
    const moved = candidate.priority ? [] : options.map((option) => {
      if (shape === 'circle') return { ...option, shift: 0 };
      const x = Math.max(insets.left + 2, Math.min(size.width - insets.right - 2 - width, option.x));
      const y = Math.max(insets.top + 2, Math.min(size.height - insets.bottom - 2 - height, option.y));
      return { ...option, x, y, shift: Math.abs(x - option.x) + Math.abs(y - option.y) };
    }).sort((a, b) => a.shift - b.shift);
    // A name keeps off the route when a side allows it.
    const clean = [...inFrame, ...moved].find(option => free(option) && !onRoute(option));
    const choice = clean ?? inFrame.find(free) ?? moved.find(free) ?? moved[0];
    return choice ? { x: choice.x, y: choice.y, width, height, text, area, clean: Boolean(clean), free: free(choice) } : null;
  };
  /** Every name that finds room among the marks already taken, most important first. */
  const names = (taken: Rect[]) => {
    const marks = [...taken];
    const seen = new Set<string>();
    const found: (NonNullable<ReturnType<typeof nameBox>> & { id: string; kind: Overlay['labels'][number]['kind']; own: boolean; coordinate: Coordinate })[] = [];
    for (const candidate of candidates) {
      const point = candidate.place.coordinate;
      if (!visible(point) || seen.has(candidate.place.id) || !inside(at(point), -2)) continue;
      seen.add(candidate.place.id);
      const name = nameBox(candidate, marks);
      // A town is named once, however many of its sites the parcel passed through.
      if (!name || found.some(other => other.text === name.text && distanceKm(other.coordinate, point) < SAME_TOWN_KM)) continue;
      marks.push(name);
      found.push({ ...name, id: candidate.id, kind: name.area ? 'area' : candidate.kind, own: candidate.priority === 0, coordinate: point });
    }
    return { found, seen };
  };

  // In a close-up, far ends of the journey stay on the edge, pointing the way.
  const pointers: Overlay['pointers'] = [];
  if (mode === 'now' && route.current) {
    const viewCenter: [number, number] = shape === 'circle' ? [centerX, centerY]
      : [(insets.left + size.width - insets.right) / 2, (insets.top + size.height - insets.bottom) / 2];
    const middle = project.invert?.(viewCenter) as Coordinate | undefined;
    const ends = [route.origin?.place, route.destination].filter((place): place is NonNullable<typeof place> => Boolean(place));
    for (const place of ends) {
      if (!middle || (visible(place.coordinate) && inside(at(place.coordinate), 12))) continue;
      const distance = geoDistance(middle, place.coordinate);
      const toward = geoInterpolate(middle, place.coordinate)(Math.min(1, .01 / Math.max(distance, 1e-6))) as Coordinate;
      const [ax, ay] = at(middle);
      const [bx, by] = at(toward);
      const length = Math.hypot(bx - ax, by - ay) || 1;
      const dx = (bx - ax) / length;
      const dy = (by - ay) / length;
      let x: number;
      let y: number;
      if (shape === 'circle') {
        x = centerX + dx * (radius + 18);
        y = centerY + dy * (radius + 18);
      } else {
        const margin = 30;
        const limits = [
          dx > 0 ? (size.width - insets.right - margin - viewCenter[0]) / dx : dx < 0 ? (insets.left + margin - viewCenter[0]) / dx : Infinity,
          dy > 0 ? (size.height - insets.bottom - margin - viewCenter[1]) / dy : dy < 0 ? (insets.top + margin - viewCenter[1]) / dy : Infinity,
        ];
        const reach = Math.min(...limits);
        x = viewCenter[0] + dx * reach;
        y = viewCenter[1] + dy * reach;
      }
      const detail = formatKm(distanceKm(route.current.place.coordinate, place.coordinate), languageTag);
      // Keep the whole chip inside the frame, whichever edge it points past.
      const name = placeName(place, sites);
      const half = (textWidth(`${name} ${detail}`) + 38) / 2;
      if (shape === 'circle') {
        // Just outside the rim, then nudged back inside the box.
        x = Math.max(half + 4, Math.min(size.width - half - 4, x + dx * Math.max(0, half - 14)));
        y = Math.max(15, Math.min(size.height - 15, y));
      } else {
        x = Math.max(insets.left + half + 8, Math.min(size.width - insets.right - half - 8, x));
        y = Math.max(insets.top + 21, Math.min(size.height - insets.bottom - 21, y));
      }
      placed.push({ x: x - half, y: y - 13, width: half * 2, height: 26 });
      pointers.push({ id: place.id, x, y, angle: Math.atan2(dy, dx) * 180 / Math.PI, text: name, detail });
    }
  }

  // Pip stands beside the parcel's dot, never on it or on its name: the first spot that leaves the other dots, the route and
  // the pointers clear, and every name its place.
  let pipPlace: Overlay['pip'] = null;
  const parcelDot = pip && route.current && visible(route.current.place.coordinate) ? at(route.current.place.coordinate) : null;
  if (pip && parcelDot && inside(parcelDot, -2)) {
    const [x, y] = parcelDot;
    const ceiling = pip.ceiling ?? insets.top;
    const floor = pip.floor ?? size.height - 4;
    const chips = placed.slice(dots.length);
    const named = names(placed).found.length;
    let best: { cost: number; place: NonNullable<Overlay['pip']>; box: Rect } | null = null;
    // Every spot beside the dot at every size, before the one below it.
    const widths = pipWidths(pip.mood);
    const trials = [...widths.flatMap(width => PIP_SPOTS.map(spot => ({ width, spot }))), ...widths.map(width => ({ width, spot: PIP_SPOT_BELOW }))];
    for (const { width, spot: [dx, dy] } of trials) {
      const unit = width / PIP_FRAME.width;
      const side: PipSide = dx > 0 ? -1 : dx < 0 ? 1 : 0;
      const left = x + dx * width - PIP_FRAME.groundX * unit;
      const top = y + dy * width - PIP_FRAME.groundY * unit;
      const extents = pipExtents(pip.mood, side);
      const box = { x: left + extents.left * unit, y: top + extents.top * unit, width: (extents.right - extents.left) * unit, height: (extents.bottom - extents.top) * unit };
      const framed = shape === 'circle'
        ? [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].every(([cornerX, cornerY]) => inside([cornerX, cornerY], 4))
        : box.x >= 4 && box.x + box.width <= size.width - 4 && box.y >= ceiling && box.y + box.height <= floor;
      // How far a point on the map is from Pip himself: the corners of his box are empty.
      const outlines = pipOutlines(pip.mood, side);
      const away = (pointX: number, pointY: number) => Math.min(...outlines.map(outline => outlineDistance([(pointX - left) / unit, (pointY - top) / unit], outline))) * unit;
      if (!framed || away(x, y) < 10) continue;
      const beside = names([...placed, box]).found;
      const own = beside.find(name => name.own);
      if (own && !own.free) continue;
      const cost = dots.filter(mark => away(mark.x, mark.y) < 6).length
        + tracks.filter(track => track.some(([trackX, trackY]) => away(trackX, trackY) < 1.5)).length
        + chips.filter(chip => intersects(box, chip)).length
        + (own && !own.clean ? 1 : 0) + Math.max(0, named - beside.length);
      if (!best || cost < best.cost) best = { cost, place: { x: left, y: top, width, mood: pip.mood, side, below: dy > 1 }, box };
      if (!cost) break;
    }
    if (best) {
      pipPlace = best.place;
      placed.push(best.box);
    }
  }

  const { found, seen } = names(placed);
  placed.push(...found);
  const labelBoxes: Overlay['labels'] = found.map(name => ({ id: name.id, x: name.x, y: name.y, width: name.width, text: name.text, kind: name.kind }));

  // Faint country names for orientation, fewer as the view widens.
  const spanKm = Math.min(size.width, size.height) / camera.scale * 6371;
  const maxRank = !context || labels === 'none' || spanKm < 180 || spanKm > 10000 ? 0 : spanKm > 6000 ? 2 : spanKm > 3000 ? 3 : spanKm > 1200 ? 4 : 5;
  for (const country of maxRank ? geography('coarse').countries.values() : []) {
    // Names near the rim of the globe read as clutter.
    if (country.rank > maxRank || !country.label || seen.has(country.code) || geoDistance(country.label, camera.center) > 1.15) continue;
    const [x, y] = at(country.label);
    const text = country.name.toUpperCase();
    const width = textWidth(text) * .83 + text.length * .95 + 8;
    const box = { x: x - width / 2, y: y - 9, width, height: 18 };
    if (overlaps(box) || !inside([box.x, box.y], 6) || !inside([box.x + width, box.y + 18], 6)
      || !inside([box.x + width, box.y], 6) || !inside([box.x, box.y + 18], 6)) continue;
    placed.push(box);
    labelBoxes.push({ id: `country-${country.code}`, x: box.x, y: box.y, width, text, kind: 'context' });
  }

  // In a close-up, a few big cities give bearings.
  const maxCityRank = !context || labels === 'none' || spanKm > 1600 ? -1 : spanKm > 800 ? 3 : spanKm > 400 ? 6 : 7;
  let shown = 0;
  for (const city of maxCityRank < 0 ? [] : cities()) {
    if (shown >= 7) break;
    if (city.rank > maxCityRank || !visible(city.coordinate)) continue;
    if (route.stops.some(stop => distanceKm(stop.place.coordinate, city.coordinate) < 12)
      || (route.destination && distanceKm(route.destination.coordinate, city.coordinate) < 12)) continue;
    const [x, y] = at(city.coordinate);
    const width = textWidth(city.name) * .87 + 12;
    const box = { x: x - 3, y: y - 8, width, height: 16 };
    if (overlaps(box) || !inside([box.x, box.y], 4) || !inside([box.x + width, box.y + 16], 4)
      || !inside([box.x + width, box.y], 4) || !inside([box.x, box.y + 16], 4)) continue;
    placed.push(box);
    labelBoxes.push({ id: `city-${city.name}-${city.coordinate.join()}`, x: box.x, y: box.y, width, text: city.name, kind: 'city' });
    shown += 1;
  }

  return { legs, stroke, dots, labels: labelBoxes, pointers, pip: pipPlace };
}
