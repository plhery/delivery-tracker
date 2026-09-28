'use client';

import { geoCircle, geoDistance, geoGraticule, geoInterpolate, geoPath } from 'd3-geo';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { easeInOut, fitCamera, interpolateCamera, projection, subsolarPoint, type Box, type Camera } from './camera';
import { cities, geography, type Coordinate, type Part } from './geography';
import { NEAR_KM, distanceKm, formatKm, type MapMode, type Route, type Scale } from './route';
import styles from './map.module.css';

export interface Insets { top: number; right: number; bottom: number; left: number }
type Size = { width: number; height: number };
type Shape = 'rect' | 'circle';
type Look = 'map' | 'tint';

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const COLORS = ['space', 'ocean', 'land', 'visited', 'border', 'night', 'grid', 'limb', 'shade'] as const;
type Palette = Record<(typeof COLORS)[number], string>;
const graticule = geoGraticule().step([30, 30])();
const LABEL_FONT = '500 11.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const MIN_SPAN: Record<Scale, number> = { world: 400, region: 300, local: 120, city: 24, point: 260, none: 0 };
// With nothing to show yet, the globe rests on the parcel's likely destination.
const RESTING_CENTER: Coordinate = [8.2, 42];

export function WorldMap({
  route, mode, shape = 'rect', insets = NO_INSETS, look = 'map', labels = 'all', context = true, interactive = false, night = false,
  time, redrawKey = '', recenter = 0, onFreeChange, className = '', style,
}: {
  route: Route;
  mode: MapMode;
  shape?: Shape;
  insets?: Insets;
  look?: Look;
  labels?: 'all' | 'ends' | 'none';
  /** Faint country and city names for orientation. */
  context?: boolean;
  interactive?: boolean;
  /** Shade the night side when the globe is zoomed out. */
  night?: boolean;
  /** When the scene happens: it sets the night side. */
  time: Date;
  /** Changes whenever the colours may have changed, such as the theme. */
  redrawKey?: string;
  /** Increment to bring a dragged globe back to the parcel. */
  recenter?: number;
  onFreeChange?: (free: boolean) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const probes = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [free, setFree] = useState(false);
  // Pointers and faint names wait for the camera to land instead of jittering in flight.
  const [moving, setMoving] = useState(false);
  const current = useRef<Camera | null>(null);
  const frame = useRef(0);
  const drag = useRef<{ x: number; y: number; camera: Camera; id: number } | null>(null);
  const clip = `map${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize(previous => previous?.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { top, right, bottom, left } = insets;
  const target = useMemo(() => size ? targetCamera(route, mode, size, { top, right, bottom, left }, shape) : null,
    [route, mode, size, top, right, bottom, left, shape]);

  useEffect(() => {
    if (!target || !size) return;
    const from = current.current;
    const interpolate = from && !matchMedia('(prefers-reduced-motion: reduce)').matches
      ? interpolateCamera(from, target, Math.max(size.width, size.height)) : null;
    const duration = from ? Math.min(1500, 700 + geoDistance(from.center, target.center) * 500
      + Math.abs(Math.log(target.scale / from.scale)) * 120) : 0;
    let start = 0;
    // Every update happens in animation frames, so a new target never renders twice.
    const step = (now: number) => {
      if (!start) {
        start = now;
        setFree(false);
        onFreeChange?.(false);
      }
      const t = interpolate ? Math.min(1, (now - start) / duration) : 1;
      const next = interpolate ? interpolate(easeInOut(t)) : target;
      current.current = next;
      setCamera(next);
      setMoving(t < 1);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [target, recenter, size, onFreeChange]);

  useLayoutEffect(() => {
    if (!camera || !size || !canvas.current || !probes.current) return;
    const circle = shape === 'circle' ? circleOf(size, { top, right, bottom, left }) : null;
    draw(canvas.current, size, camera, readPalette(probes.current), route, night ? time : null, circle);
  }, [camera, size, route, time, night, shape, look, redrawKey, top, right, bottom, left]);

  const overlay = camera && size ? layout(route, camera, size, insets, shape, labels, mode, context) : null;
  const circle = shape === 'circle' && size ? circleOf(size, insets) : null;

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!interactive || !current.current || event.button > 0) return;
    // Keep the parcel sheet's edge swipe from treating a pan as "back".
    event.stopPropagation();
    cancelAnimationFrame(frame.current);
    setMoving(false);
    drag.current = { x: event.clientX, y: event.clientY, camera: current.current, id: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!free && Math.hypot(dx, dy) < 4) return;
    const degrees = 180 / Math.PI / start.camera.scale;
    const next: Camera = {
      ...start.camera,
      center: [start.camera.center[0] - dx * degrees, Math.max(-80, Math.min(80, start.camera.center[1] + dy * degrees))],
    };
    current.current = next;
    setCamera(next);
    if (!free) {
      setFree(true);
      onFreeChange?.(true);
    }
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }

  return <div ref={root} className={`${styles.worldMap} ${className}`} style={style} data-shape={shape} data-look={look}
    role="img" aria-label={describe(route)}
    data-interactive={interactive || undefined} data-scale={route.scale} data-mode={mode}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
    <span ref={probes} className={styles.probes} aria-hidden="true">
      {COLORS.map(name => <span key={name} data-color={name} style={{ color: `var(--map-${name})` }} />)}
    </span>
    <canvas ref={canvas} className={styles.mapCanvas} aria-hidden="true" />
    {overlay && <svg className={styles.mapOverlay} viewBox={`0 0 ${size!.width} ${size!.height}`} aria-hidden="true">
      {circle && <defs><clipPath id={clip}><circle cx={circle.x} cy={circle.y} r={circle.radius} /></clipPath></defs>}
      <g clipPath={circle ? `url(#${clip})` : undefined}>
        {overlay.legs.map(leg => <path key={leg.id} d={leg.d} className={styles.leg} data-kind={leg.kind}
          pathLength={leg.kind === 'travelled' ? 1 : undefined} />)}
        {overlay.dots.map(dot => <g key={dot.id} className={styles.dot} data-kind={dot.kind} transform={`translate(${dot.x} ${dot.y})`}>
          {dot.kind === 'current' && <circle className={styles.halo} r="5" />}
          <circle r={dot.kind === 'current' ? 5 : dot.kind === 'origin' ? 3.5 : dot.kind === 'stop' ? 2.6 : 4.5} />
        </g>)}
      </g>
    </svg>}
    {circle && <span className={styles.rim} aria-hidden="true"
      style={{ left: circle.x - circle.radius, top: circle.y - circle.radius, width: circle.radius * 2, height: circle.radius * 2 }} />}
    {overlay?.labels.filter(label => !moving || (label.kind !== 'context' && label.kind !== 'city'))
      .map(label => <span key={label.id} className={styles.placeLabel} data-kind={label.kind}
        style={{ transform: `translate(${label.x}px, ${label.y}px)` }} aria-hidden="true">{label.text}</span>)}
    {!moving && overlay?.pointers.map(pointer => <span key={pointer.id} className={styles.pointer}
      style={{ transform: `translate(${pointer.x}px, ${pointer.y}px) translate(-50%, -50%)` }} aria-hidden="true">
      <svg viewBox="0 0 12 12" style={{ transform: `rotate(${pointer.angle}deg)` }}><path d="M2 6h8M7 3l3 3-3 3" /></svg>
      <span><strong>{pointer.text}</strong> {pointer.detail}</span>
    </span>)}
  </div>;
}

function describe(route: Route): string {
  if (!route.origin) return 'Map: no places reported yet';
  const end = route.destination ?? route.current!.place;
  if (end === route.origin.place) return `Map: ${end.name}`;
  return `Map: from ${route.origin.place.name} to ${end.name}${route.km >= 1 ? `, ${formatKm(route.km)} so far` : ''}`;
}

/** A round map sits in the middle of its box, inset so rim pointers fit. */
export function circleOf(size: Size, insets: Insets) {
  const width = size.width - insets.left - insets.right;
  const height = size.height - insets.top - insets.bottom;
  return { x: insets.left + width / 2, y: insets.top + height / 2, radius: Math.min(width, height) / 2 };
}

function targetCamera(route: Route, mode: MapMode, size: Size, insets: Insets, shape: Shape): Camera {
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
    return fitCamera(points, box, { shape, minSpanKm: 260 });
  }
  const ends = [...route.stops.map(stop => stop.place.coordinate), ...(destination ? [destination] : [])];
  // Frame the arcs as well as their ends, so a bowed route never leaves the view.
  const arcs = [...route.legs.map(leg => [leg.from.place.coordinate, leg.to.place.coordinate, leg.km] as const),
    ...(current && destination ? [[current, destination, route.remainingKm ?? 0] as const] : [])]
    .filter(([, , km]) => km > 300)
    .flatMap(([from, to]) => [.25, .5, .75].map(t => geoInterpolate(from, to)(t) as Coordinate));
  const camera = ends.length
    ? fitCamera([...ends, ...arcs], box, { shape, minSpanKm: MIN_SPAN[route.scale], tilt: route.scale === 'world' })
    : fitCamera([RESTING_CENTER], box, { shape, minSpanKm: 1e5, globeAbove: -1 });
  if (shape === 'circle') {
    // A round window shows either the whole globe or a close-up, never a globe inside a circle.
    const circle = circleOf(size, insets);
    if (camera.scale < circle.radius * 1.3) return { center: camera.center, scale: circle.radius, offset: [circle.x, circle.y] };
  }
  return camera;
}

function readPalette(element: HTMLElement): Palette {
  const palette = {} as Palette;
  for (const probe of element.children) {
    const name = (probe as HTMLElement).dataset.color as keyof Palette;
    palette[name] = getComputedStyle(probe).color;
  }
  return palette;
}

const transparent = (color: string) => color === 'transparent' || /^rgba\(.*,\s*0\)$/.test(color) || color.endsWith('/ 0)');

function draw(canvas: HTMLCanvasElement, size: Size, camera: Camera, palette: Palette, route: Route, time: Date | null,
  circle: { x: number; y: number; radius: number } | null) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
  const width = Math.round(size.width * ratio);
  const height = Math.round(size.height * ratio);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, size.width, size.height);
  const project = projection(camera).clipExtent([[-2, -2], [size.width + 2, size.height + 2]]);
  const path = geoPath(project, context);
  const span = Math.min(size.width, size.height) / camera.scale;
  const detail = span < .45 ? 'fine' : 'coarse';
  const world = geography(detail);
  // Only shapes whose cap reaches the view: a close-up draws a few countries, not all of them.
  const reach = Math.max(...[[0, 0], [size.width, 0], [0, size.height], [size.width, size.height]]
    .map(([x, y]) => Math.hypot(x - camera.offset[0], y - camera.offset[1]))) / camera.scale;
  const view = reach >= 1 ? Math.PI / 2 : Math.asin(reach) + .02;
  const inView = <T,>(parts: readonly Part<T>[]) => parts.filter(item => geoDistance(item.center, camera.center) - item.radius < view)
    .map(item => item.shape);
  // 0 in a close-up, 1 once the curve of the Earth shows.
  const globe = Math.max(0, Math.min(1, (span - .5) / .9));
  context.save();
  if (circle) {
    context.beginPath();
    context.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
    context.clip();
  }
  context.fillStyle = palette.space;
  context.fillRect(0, 0, size.width, size.height);
  context.beginPath();
  path({ type: 'Sphere' });
  context.fillStyle = palette.ocean;
  context.fill();
  if (globe > 0 && !transparent(palette.grid)) {
    context.globalAlpha = globe;
    context.beginPath();
    path(graticule);
    context.strokeStyle = palette.grid;
    context.lineWidth = .6;
    context.stroke();
    context.globalAlpha = 1;
  }
  context.beginPath();
  path({ type: 'MultiPolygon', coordinates: inView(world.land) });
  context.fillStyle = palette.land;
  context.fill();
  // Countries the parcel passed through, once the view is wide enough to hold several.
  const spanKm = span * 6371;
  const visited = Math.max(0, Math.min(1, (spanKm - 800) / 1600));
  if (visited > 0) {
    context.beginPath();
    for (const code of route.countries) {
      const country = world.countries.get(code);
      if (country) path(country.shape);
    }
    context.globalAlpha = visited;
    context.fillStyle = palette.visited;
    context.fill();
    context.globalAlpha = 1;
  }
  if (detail === 'fine') {
    context.beginPath();
    path({ type: 'MultiPolygon', coordinates: inView(world.lakes) });
    if (transparent(palette.ocean)) {
      context.globalCompositeOperation = 'destination-out';
      context.fillStyle = '#000';
    } else {
      context.fillStyle = palette.ocean;
    }
    context.fill();
    context.globalCompositeOperation = 'source-over';
  }
  if (time && globe > 0 && !transparent(palette.night)) {
    // Twenty thin bands fade the night side in over 24°, like dusk.
    const sun = subsolarPoint(time);
    const antipode: Coordinate = [sun[0] + 180, -sun[1]];
    context.fillStyle = palette.night;
    context.globalAlpha = globe / 20;
    for (let radius = 92; radius > 68; radius -= 1.2) {
      context.beginPath();
      path(geoCircle().center(antipode).radius(radius)());
      context.fill();
    }
    context.globalAlpha = 1;
  }
  context.beginPath();
  path({ type: 'MultiLineString', coordinates: inView(world.borders) });
  context.strokeStyle = palette.border;
  context.lineWidth = detail === 'fine' ? .8 : .55;
  context.stroke();
  if (globe > 0 && !transparent(palette.shade)) {
    // A soft falloff toward the rim makes the globe read as a sphere.
    const [x, y] = camera.offset;
    const gradient = context.createRadialGradient(x, y, camera.scale * .55, x, y, camera.scale);
    gradient.addColorStop(0, 'transparent');
    gradient.addColorStop(1, palette.shade);
    context.beginPath();
    path({ type: 'Sphere' });
    context.globalAlpha = globe;
    context.fillStyle = gradient;
    context.fill();
    context.globalAlpha = 1;
  }
  if (globe > 0 && !transparent(palette.limb)) {
    context.beginPath();
    path({ type: 'Sphere' });
    context.globalAlpha = globe;
    context.strokeStyle = palette.limb;
    context.lineWidth = 1;
    context.stroke();
    context.globalAlpha = 1;
  }
  context.restore();
}

interface Overlay {
  legs: { id: string; d: string; kind: 'travelled' | 'approximate' | 'remaining' }[];
  dots: { id: string; x: number; y: number; kind: 'origin' | 'stop' | 'current' | 'last-known' | 'area' | 'destination' }[];
  labels: { id: string; x: number; y: number; text: string; kind: 'current' | 'end' | 'stop' | 'area' | 'context' | 'city' }[];
  pointers: { id: string; x: number; y: number; angle: number; text: string; detail: string }[];
}

let measure: CanvasRenderingContext2D | null = null;
function textWidth(text: string): number {
  measure ??= document.createElement('canvas').getContext('2d');
  if (!measure) return text.length * 6.5;
  measure.font = LABEL_FONT;
  return measure.measureText(text).width;
}

function layout(route: Route, camera: Camera, size: Size, insets: Insets, shape: Shape, labels: 'all' | 'ends' | 'none', mode: MapMode, context: boolean): Overlay {
  const project = projection(camera).clipExtent([[-400, -400], [size.width + 400, size.height + 400]]);
  const svgPath = geoPath(project);
  const visible = (point: Coordinate) => geoDistance(point, camera.center) < Math.PI / 2 - .02;
  const at = (point: Coordinate) => project(point) ?? [0, 0];
  const { x: centerX, y: centerY, radius } = circleOf(size, insets);
  const inside = ([x, y]: readonly [number, number], margin = 0) => shape === 'circle'
    ? Math.hypot(x - centerX, y - centerY) < radius - margin
    : x > insets.left + margin && x < size.width - insets.right - margin && y > insets.top + margin && y < size.height - insets.bottom - margin;

  const legPath = (a: Coordinate, b: Coordinate, km: number) => {
    if (km < 900 && visible(a) && visible(b)) {
      // Short hops bow slightly to the left of travel: a hop, not a road.
      const [x1, y1] = at(a);
      const [x2, y2] = at(b);
      const length = Math.hypot(x2 - x1, y2 - y1) || 1;
      const bend = Math.min(length * .18, 70);
      const cx = (x1 + x2) / 2 + (y2 - y1) / length * bend;
      const cy = (y1 + y2) / 2 - (x2 - x1) / length * bend;
      return `M${x1.toFixed(1)},${y1.toFixed(1)}Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
    }
    return svgPath({ type: 'LineString', coordinates: [a, b] }) ?? '';
  };

  const legs: Overlay['legs'] = route.legs.map(leg => ({
    id: leg.id,
    d: legPath(leg.from.place.coordinate, leg.to.place.coordinate, leg.km),
    kind: leg.from.place.precision === 'country' || leg.to.place.precision === 'country' ? 'approximate' : 'travelled',
  }));
  if (route.current && route.destination) legs.unshift({
    id: `remaining-${route.destination.id}`,
    d: legPath(route.current.place.coordinate, route.destination.coordinate, route.remainingKm ?? 0),
    kind: 'remaining',
  });

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
  const placed: { x: number; y: number; width: number; height: number }[] = dots.map(dot => ({ x: dot.x - 6, y: dot.y - 6, width: 12, height: 12 }));
  const overlaps = (box: typeof placed[number]) => placed.some(other => box.x < other.x + other.width && box.x + box.width > other.x
    && box.y < other.y + other.height && box.y + box.height > other.y);
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
  const seen = new Set<string>();
  const labelBoxes: Overlay['labels'] = [];
  for (const candidate of labels === 'none' ? [] : candidates) {
    const point = candidate.place.coordinate;
    if (!visible(point) || seen.has(candidate.place.id)) continue;
    const [x, y] = at(point);
    if (!inside([x, y], -2)) continue;
    seen.add(candidate.place.id);
    const area = candidate.place.precision === 'country';
    const text = area ? candidate.place.name.toUpperCase() : candidate.place.name;
    const width = area ? textWidth(text) * .91 + text.length * .84 + 10 : textWidth(text) + 14;
    const height = 22;
    const [awayX, awayY] = legDirection(candidate.id, x, y);
    const options = (area
      ? [{ x: x - width / 2, y: y + 8, dx: 0, dy: 1 }, { x: x - width / 2, y: y - 30, dx: 0, dy: -1 },
        { x: x + 8, y: y + 6, dx: 1, dy: 1 }, { x: x - width - 8, y: y + 6, dx: -1, dy: 1 }]
      : [{ x: x + 9, y: y - height / 2, dx: 1, dy: 0 }, { x: x - 9 - width, y: y - height / 2, dx: -1, dy: 0 },
        { x: x - width / 2, y: y - 29, dx: 0, dy: -1 }, { x: x - width / 2, y: y + 8, dx: 0, dy: 1 }])
      .map((option, index) => ({ ...option, order: option.dx * awayX + option.dy * awayY + index * .01 }))
      .sort((a, b) => a.order - b.order);
    const choice = options.find(option => {
      const box = { ...option, width, height };
      return !overlaps(box) && inside([box.x, box.y], 2) && inside([box.x + width, box.y + height], 2)
        && inside([box.x + width, box.y], 2) && inside([box.x, box.y + height], 2);
    }) ?? (candidate.priority === 0 ? options[0] : null);
    if (!choice) continue;
    placed.push({ ...choice, width, height });
    labelBoxes.push({ id: candidate.id, x: choice.x, y: choice.y, text, kind: area ? 'area' : candidate.kind });
  }

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
      const detail = formatKm(distanceKm(route.current.place.coordinate, place.coordinate));
      // Keep the whole chip inside the frame, whichever edge it points past.
      const half = (textWidth(`${place.name} ${detail}`) + 38) / 2;
      if (shape === 'circle') {
        // Just outside the rim, then nudged back inside the box.
        x = Math.max(half + 4, Math.min(size.width - half - 4, x + dx * Math.max(0, half - 14)));
        y = Math.max(15, Math.min(size.height - 15, y));
      } else {
        x = Math.max(insets.left + half + 8, Math.min(size.width - insets.right - half - 8, x));
        y = Math.max(insets.top + 21, Math.min(size.height - insets.bottom - 21, y));
      }
      placed.push({ x: x - half, y: y - 13, width: half * 2, height: 26 });
      pointers.push({ id: place.id, x, y, angle: Math.atan2(dy, dx) * 180 / Math.PI, text: place.name, detail });
    }
  }
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
    labelBoxes.push({ id: `country-${country.code}`, x: box.x, y: box.y, text, kind: 'context' });
  }

  // In a close-up, a few big cities give bearings.
  const maxCityRank = !context || labels === 'none' || spanKm > 1600 ? -1 : spanKm > 800 ? 3 : spanKm > 400 ? 6 : 7;
  let shown = 0;
  for (const city of maxCityRank < 0 ? [] : cities) {
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
    labelBoxes.push({ id: `city-${city.name}-${city.coordinate.join()}`, x: box.x, y: box.y, text: city.name, kind: 'city' });
    shown += 1;
  }

  return { legs, dots, labels: labelBoxes, pointers };
}

