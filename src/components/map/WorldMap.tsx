'use client';

import { geoCircle, geoDistance, geoGraticule, geoInterpolate, geoPath } from 'd3-geo';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { easeInOut, fitCamera, interpolateCamera, projection, subsolarPoint, zoomCamera, type Box, type Camera } from './camera';
import { cities, geography, useWorld, type Coordinate, type Part } from './geography';
import { InkPip, PIP_FRAME, PIP_SPOTS, PIP_SPOT_BELOW, outlineDistance, pipExtents, pipOutlines, pipWidths, type PipMood, type PipSide } from './Pip';
import { NEAR_KM, distanceKm, formatKm, placeName, type MapMode, type Route, type Scale } from './route';
import styles from './map.module.css';

export interface Insets { top: number; right: number; bottom: number; left: number }
export interface PipPlacing {
  mood: PipMood;
  /** Where the card's top row ends; the top inset when absent. */
  ceiling?: number;
  /** Where the card starts writing over the bottom of the map; the map's bottom edge when absent. */
  floor?: number;
}
type Size = { width: number; height: number };
type Shape = 'rect' | 'circle';
type Look = 'map' | 'tint';

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const COLORS = ['space', 'ocean', 'land', 'visited', 'border', 'night', 'grid', 'limb', 'shade'] as const;
type Palette = Record<(typeof COLORS)[number], string>;
const graticule = geoGraticule().step([30, 30])();
const LABEL_FONT = '500 11.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const MIN_SPAN: Record<Scale, number> = { world: 400, region: 300, local: 120, city: 24, point: 260, none: 0 };
// A town is named once, however many of its sites the parcel passed through.
const SAME_TOWN_KM = 30;
// With nothing to show yet, the globe rests on the parcel's likely destination.
const RESTING_CENTER: Coordinate = [8.2, 42];

export function WorldMap({
  route, mode, shape = 'rect', insets = NO_INSETS, look = 'map', labels = 'all', sites = false, context = true, interactive = false, night = false,
  time, redrawKey = '', recenter = 0, onFreeChange, className = '', style, label, languageTag = 'en', live = true, peek = false, pip = null,
  framing, glide = false,
}: {
  route: Route;
  mode: MapMode;
  shape?: Shape;
  insets?: Insets;
  look?: Look;
  labels?: 'all' | 'ends' | 'none';
  /** Names a facility by its own name ("Zürich-Mülligen") rather than its town's. */
  sites?: boolean;
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
  /** What the map shows, for screen readers. */
  label?: string;
  /** Formats the distances on edge pointers. */
  languageTag?: string;
  /** Pulses the parcel's current position. */
  live?: boolean;
  /** Pinching zooms for a moment; the map settles back when the fingers lift. */
  peek?: boolean;
  /** Pip stands beside the parcel's place in this mood. */
  pip?: PipPlacing | null;
  /** The route the camera frames instead of the one drawn, so a journey told scan by scan keeps one picture. */
  framing?: Route;
  /** The parcel's dot and Pip travel to a new place instead of appearing there. */
  glide?: boolean;
}) {
  const ready = useWorld();
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const probes = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [camera, setCamera] = useState<Camera | null>(null);
  // Whether the map was moved away from the parcel; read in handlers, so a ref.
  const free = useRef(false);
  const [settle, setSettle] = useState(0);
  // Pointers and faint names wait for the camera to land instead of jittering in flight.
  const [moving, setMoving] = useState(false);
  const current = useRef<Camera | null>(null);
  const frame = useRef(0);
  const drag = useRef<{ x: number; y: number; camera: Camera; id: number } | null>(null);
  // Fingers on the map, relative to it, and the pinch they make.
  const touches = useRef(new Map<number, [number, number]>());
  const pinch = useRef<{ distance: number; anchor: [number, number]; camera: Camera } | null>(null);
  const pinchedAt = useRef(-Infinity);
  const clip = `map${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  useLayoutEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize(previous => previous?.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { top, right, bottom, left } = insets;
  const framed = framing ?? route;
  const target = useMemo(() => ready && size ? targetCamera(framed, mode, size, { top, right, bottom, left }, shape) : null,
    [ready, framed, mode, size, top, right, bottom, left, shape]);

  // Only a change of view, or recentering, brings a moved map back; a new frame or scan leaves it where it was put.
  useEffect(() => {
    free.current = false;
  }, [mode, recenter]);

  useEffect(() => {
    if (!target || !size || free.current) return;
    const from = current.current;
    // A new scan that frames the map the same way needs no flight, which would hide the names while it runs.
    if (from && sameCamera(from, target)) return;
    const interpolate = from && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? interpolateCamera(from, target, Math.max(size.width, size.height)) : null;
    const duration = from ? Math.min(1500, 700 + geoDistance(from.center, target.center) * 500
      + Math.abs(Math.log(target.scale / from.scale)) * 120) : 0;
    let start = 0;
    // Every update happens in animation frames, so a new target never renders twice.
    const step = (now: number) => {
      if (!start) {
        start = now;
        free.current = false;
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
  }, [target, recenter, settle, size, onFreeChange]);

  // A wheel or a trackpad pinch zooms about the pointer.
  useEffect(() => {
    const element = root.current;
    if (!element || !interactive || !size) return;
    const view = zoomArea(size, { top, right, bottom, left }, shape);
    const onWheel = (event: WheelEvent) => {
      const from = current.current;
      if (!from) return;
      event.preventDefault();
      const box = element.getBoundingClientRect();
      // Trackpad pinches arrive as small ctrl-wheel steps, mouse wheels as larger ones.
      const next = zoomCamera(from, Math.exp(-event.deltaY * (event.ctrlKey ? .01 : .002)),
        [event.clientX - box.left, event.clientY - box.top], view.middle, view.viewport);
      cancelAnimationFrame(frame.current);
      setMoving(false);
      current.current = next;
      setCamera(next);
      if (!free.current) {
        free.current = true;
        onFreeChange?.(true);
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [interactive, size, top, right, bottom, left, shape, onFreeChange]);

  useLayoutEffect(() => {
    if (!camera || !size || !canvas.current || !probes.current) return;
    const circle = shape === 'circle' ? circleOf(size, { top, right, bottom, left }) : null;
    draw(canvas.current, size, camera, readPalette(probes.current), route, night ? time : null, circle);
  }, [camera, size, route, time, night, shape, look, redrawKey, top, right, bottom, left]);

  const overlay = camera && size ? layout(route, camera, size, insets, shape, labels, sites, mode, context, languageTag, pip) : null;
  const circle = shape === 'circle' && size ? circleOf(size, insets) : null;

  function local(event: PointerEvent<HTMLDivElement>): [number, number] {
    const box = event.currentTarget.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  }

  function markFree() {
    if (free.current) return;
    free.current = true;
    onFreeChange?.(true);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if ((!interactive && !peek) || !current.current || event.button > 0) return;
    touches.current.set(event.pointerId, local(event));
    if (touches.current.size === 2) {
      // A second finger turns a drag into a pinch.
      const [a, b] = [...touches.current.values()];
      pinch.current = { distance: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, anchor: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], camera: current.current };
      drag.current = null;
      for (const id of touches.current.keys()) event.currentTarget.setPointerCapture(id);
    } else if (interactive) {
      drag.current = { x: event.clientX, y: event.clientY, camera: current.current, id: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
    } else {
      // One finger on a card still scrolls the page or taps the map open.
      return;
    }
    // Keep the parcel sheet's edge swipe from treating a pan as "back".
    event.stopPropagation();
    cancelAnimationFrame(frame.current);
    setMoving(false);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (touches.current.has(event.pointerId)) touches.current.set(event.pointerId, local(event));
    const zoom = pinch.current;
    if (zoom && size) {
      event.stopPropagation();
      const [a, b] = [...touches.current.values()];
      const view = zoomArea(size, insets, shape);
      const zoomed = zoomCamera(zoom.camera, Math.hypot(a[0] - b[0], a[1] - b[1]) / zoom.distance, zoom.anchor, view.middle, view.viewport);
      // The fingers carry the map along as they spread.
      const next: Camera = { ...zoomed, offset: [zoomed.offset[0] + (a[0] + b[0]) / 2 - zoom.anchor[0], zoomed.offset[1] + (a[1] + b[1]) / 2 - zoom.anchor[1]] };
      current.current = next;
      setCamera(next);
      if (interactive) markFree();
      return;
    }
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!free.current && Math.hypot(dx, dy) < 4) return;
    const degrees = 180 / Math.PI / start.camera.scale;
    const next: Camera = {
      ...start.camera,
      center: [start.camera.center[0] - dx * degrees, Math.max(-80, Math.min(80, start.camera.center[1] + dy * degrees))],
    };
    current.current = next;
    setCamera(next);
    markFree();
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    touches.current.delete(event.pointerId);
    if (drag.current?.id === event.pointerId) drag.current = null;
    if (pinch.current && touches.current.size < 2) {
      pinch.current = null;
      pinchedAt.current = event.timeStamp;
      // A card's map settles back once the fingers lift.
      if (!interactive) setSettle((count) => count + 1);
    }
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    // Lifting the fingers from a pinch is not a tap.
    if (event.timeStamp - pinchedAt.current < 400) event.stopPropagation();
  }

  return <div ref={root} className={`${styles.worldMap} ${className}`} style={style} data-shape={shape} data-look={look}
    role="img" aria-label={label ?? describe(route)}
    data-interactive={interactive || undefined} data-peek={peek || undefined} data-scale={route.scale} data-mode={mode}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
    onClickCapture={onClickCapture}>
    <span ref={probes} className={styles.probes} aria-hidden="true">
      {COLORS.map(name => <span key={name} data-color={name} style={{ color: `var(--map-${name})` }} />)}
    </span>
    <div className={styles.layers}>
      <canvas ref={canvas} className={styles.mapCanvas} aria-hidden="true" />
      {overlay && <svg className={styles.mapOverlay} viewBox={`0 0 ${size!.width} ${size!.height}`} aria-hidden="true">
        {circle && <defs><clipPath id={clip}><circle cx={circle.x} cy={circle.y} r={circle.radius} /></clipPath></defs>}
        <g clipPath={circle ? `url(#${clip})` : undefined}>
          {overlay.legs.map(leg => <path key={leg.id} d={leg.d} className={styles.leg} data-kind={leg.kind}
            pathLength={leg.kind === 'travelled' ? 1 : undefined} />)}
          {overlay.dots.map(dot => {
            // A dot that travels is one element from place to place, moved by a style so the move can be eased.
            const travels = glide && dot.kind === 'current';
            return <g key={travels ? 'current' : dot.id} className={styles.dot} data-kind={dot.kind} data-glide={travels || undefined}
              transform={travels ? undefined : `translate(${dot.x} ${dot.y})`}
              style={travels ? { transform: `translate(${dot.x.toFixed(1)}px, ${dot.y.toFixed(1)}px)` } : undefined}>
              {dot.kind === 'current' && live && <circle className={styles.halo} r="5" />}
              <circle r={dot.kind === 'current' ? 5 : dot.kind === 'origin' ? 3.5 : dot.kind === 'stop' ? 2.6 : 4.5} />
            </g>;
          })}
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
    </div>
    {overlay?.pip && <span className={styles.pip} data-pip={overlay.pip.mood} data-side={overlay.pip.side} data-glide={glide || undefined} aria-hidden="true"
      style={{ transform: `translate(${overlay.pip.x.toFixed(1)}px, ${overlay.pip.y.toFixed(1)}px)`, width: overlay.pip.width }}>
      <span className={styles.pipIn}><InkPip mood={overlay.pip.mood} side={overlay.pip.side} below={overlay.pip.below} /></span>
    </span>}
  </div>;
}

function describe(route: Route): string {
  if (!route.origin) return 'Map: no places reported yet';
  const end = route.destination ?? route.current!.place;
  if (end === route.origin.place) return `Map: ${end.name}`;
  return `Map: from ${route.origin.place.name} to ${end.name}${route.km >= 1 ? `, ${formatKm(route.km)} so far` : ''}`;
}

/** Where zooming settles a globe that no longer fills the view, and how much view there is. */
function zoomArea(size: Size, insets: Insets, shape: Shape): { middle: [number, number]; viewport: number } {
  if (shape === 'circle') {
    const { x, y, radius } = circleOf(size, insets);
    return { middle: [x, y], viewport: radius * 2 };
  }
  return {
    middle: [(insets.left + size.width - insets.right) / 2, (insets.top + size.height - insets.bottom) / 2],
    viewport: Math.min(size.width - insets.left - insets.right, size.height - insets.top - insets.bottom),
  };
}

function sameCamera(a: Camera, b: Camera): boolean {
  return Math.abs(a.scale - b.scale) < b.scale * 1e-6 && geoDistance(a.center, b.center) < 1e-9
    && Math.abs(a.offset[0] - b.offset[0]) < .01 && Math.abs(a.offset[1] - b.offset[1]) < .01;
}

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
    // The night side darkens over 24° past the terminator, like dusk: twenty rings, each drawn
    // once at its own depth, since stacking twenty faint fills rounds them away.
    const sun = subsolarPoint(time);
    const antipode: Coordinate = [sun[0] + 180, -sun[1]];
    context.fillStyle = palette.night;
    for (let band = 0; band < 20; band += 1) {
      const outer = 92 - band * 1.2;
      context.beginPath();
      path(geoCircle().center(antipode).radius(outer)());
      if (band < 19) path(geoCircle().center(antipode).radius(outer - 1.2)());
      context.globalAlpha = globe * (band + 1) / 20;
      context.fill('evenodd');
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
  /** Where Pip's frame starts, how wide it is, and which side of him the parcel's dot is on. */
  pip: { x: number; y: number; width: number; mood: PipMood; side: PipSide; below: boolean } | null;
}

type Rect = { x: number; y: number; width: number; height: number };
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

let measure: CanvasRenderingContext2D | null = null;
function textWidth(text: string): number {
  measure ??= document.createElement('canvas').getContext('2d');
  if (!measure) return text.length * 6.5;
  measure.font = LABEL_FONT;
  return measure.measureText(text).width;
}

function layout(route: Route, camera: Camera, size: Size, insets: Insets, shape: Shape, labels: 'all' | 'ends' | 'none', sites: boolean,
  mode: MapMode, context: boolean, languageTag: string, pip: PipPlacing | null = null): Overlay {
  const project = projection(camera).clipExtent([[-400, -400], [size.width + 400, size.height + 400]]);
  const svgPath = geoPath(project);
  const visible = (point: Coordinate) => geoDistance(point, camera.center) < Math.PI / 2 - .02;
  const at = (point: Coordinate) => project(point) ?? [0, 0];
  const { x: centerX, y: centerY, radius } = circleOf(size, insets);
  const inside = ([x, y]: readonly [number, number], margin = 0) => shape === 'circle'
    ? Math.hypot(x - centerX, y - centerY) < radius - margin
    : x > insets.left + margin && x < size.width - insets.right - margin && y > insets.top + margin && y < size.height - insets.bottom - margin;

  // A leg as it is drawn, and sampled along its curve so names and Pip can keep off it.
  const tracks: [number, number][][] = [];
  const legPath = (a: Coordinate, b: Coordinate, km: number) => {
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
      return `M${x1.toFixed(1)},${y1.toFixed(1)}Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
    }
    const along = geoInterpolate(a, b);
    tracks.push(Array.from({ length: 121 }, (_, index) => along(index / 120) as Coordinate).filter(visible).map(point => at(point) as [number, number]));
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
  const labelBoxes: Overlay['labels'] = found.map(name => ({ id: name.id, x: name.x, y: name.y, text: name.text, kind: name.kind }));

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
    labelBoxes.push({ id: `city-${city.name}-${city.coordinate.join()}`, x: box.x, y: box.y, text: city.name, kind: 'city' });
    shown += 1;
  }

  return { legs, dots, labels: labelBoxes, pointers, pip: pipPlace };
}

