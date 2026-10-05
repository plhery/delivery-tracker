'use client';

import { geoCircle, geoDistance, geoGraticule, geoPath } from 'd3-geo';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { easeInOut, interpolateCamera, projection, subsolarPoint, zoomCamera, type Camera } from './camera';
import { geography, useWorld, type Coordinate } from './geography';
import { circleOf, layout, mapView, targetCamera, type Insets, type Overlay, type PipPlacing, type Shape, type Size } from './layout';
import { InkPip } from './Pip';
import { formatKm, type MapMode, type Route } from './route';
import styles from './map.module.css';

// What the map shows and where everything goes is worked out in `layout.ts`, which needs no browser.
export { circleOf, targetCamera, type Insets, type PipPlacing };
type Look = 'map' | 'tint';

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const COLORS = ['space', 'ocean', 'land', 'visited', 'border', 'night', 'grid', 'limb', 'shade'] as const;
type Palette = Record<(typeof COLORS)[number], string>;
const graticule = geoGraticule().step([30, 30])();
const LABEL_FONT = '500 11.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

export function WorldMap({
  route, mode, shape = 'rect', insets = NO_INSETS, look = 'map', labels = 'all', sites = false, context = true, interactive = false, night = false,
  time, redrawKey = '', recenter = 0, onFreeChange, className = '', style, label, languageTag = 'en', live = true, peek = false, pip = null,
  framing, glide = false, quiet = false,
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
  /** The route as part of the picture rather than its subject: thinner legs and smaller dots, drawn at once. */
  quiet?: boolean;
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
  // A gesture keeps the camera it began on. It has none while the fingers are on a map just opened that is not drawn yet.
  const drag = useRef<{ x: number; y: number; camera: Camera | null; id: number } | null>(null);
  // Fingers on the map, relative to it, and the pinch they make.
  const touches = useRef(new Map<number, [number, number]>());
  const pinch = useRef<{ distance: number; anchor: [number, number]; camera: Camera | null } | null>(null);
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

  const overlay = camera && size ? layout(route, camera, size, insets, shape, labels, sites, mode, context, languageTag, pip, textWidth) : null;
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

  /** The camera a gesture moves the map from: the one it began on, or the map's first when the fingers landed before it. */
  function held(gesture: { camera: Camera | null }): Camera | null {
    if (!gesture.camera && current.current) {
      gesture.camera = current.current;
      cancelAnimationFrame(frame.current);
      setMoving(false);
    }
    return gesture.camera;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if ((!interactive && !peek) || event.button > 0) return;
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
    // A map that is not drawn yet keeps the frame that draws it.
    if (!current.current) return;
    cancelAnimationFrame(frame.current);
    setMoving(false);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (touches.current.has(event.pointerId)) touches.current.set(event.pointerId, local(event));
    const zoom = pinch.current;
    if (zoom && size) {
      event.stopPropagation();
      const from = held(zoom);
      if (!from) return;
      const [a, b] = [...touches.current.values()];
      const view = zoomArea(size, insets, shape);
      const zoomed = zoomCamera(from, Math.hypot(a[0] - b[0], a[1] - b[1]) / zoom.distance, zoom.anchor, view.middle, view.viewport);
      // The fingers carry the map along as they spread.
      const next: Camera = { ...zoomed, offset: [zoomed.offset[0] + (a[0] + b[0]) / 2 - zoom.anchor[0], zoomed.offset[1] + (a[1] + b[1]) / 2 - zoom.anchor[1]] };
      current.current = next;
      setCamera(next);
      if (interactive) markFree();
      return;
    }
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const from = held(start);
    if (!from) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!free.current && Math.hypot(dx, dy) < 4) return;
    const degrees = 180 / Math.PI / from.scale;
    const next: Camera = {
      ...from,
      center: [from.center[0] - dx * degrees, Math.max(-80, Math.min(80, from.center[1] + dy * degrees))],
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
    data-interactive={interactive || undefined} data-peek={peek || undefined} data-quiet={quiet || undefined} data-scale={route.scale} data-mode={mode}
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
          <Legs legs={overlay.legs} stroke={overlay.stroke} />
          {overlay.dots.map(dot => {
            // A dot that travels is one element from place to place, moved by a style so the move can be eased.
            const travels = glide && dot.kind === 'current';
            return <g key={travels ? 'current' : dot.id} className={styles.dot} data-kind={dot.kind} data-glide={travels || undefined}
              transform={travels ? undefined : `translate(${dot.x} ${dot.y})`}
              style={travels ? { transform: `translate(${dot.x.toFixed(1)}px, ${dot.y.toFixed(1)}px)` } : undefined}>
              {dot.kind === 'current' && live && <circle className={styles.halo} r={dotRadius(dot.kind, quiet)} />}
              <circle r={dotRadius(dot.kind, quiet)} />
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

/**
 * How long the route's stroke takes, in milliseconds: a short route is drawn quickly, a long one never drags, and
 * a route too small to see keeps nothing waiting.
 */
const strokeTime = (stroke: number) => Math.round(Math.min(1800, 500 + stroke * 1.6, stroke * 40));

/**
 * The route's legs. Those there when the route first shows are drawn as one stroke, from the first place to the
 * parcel's, and the way still to go shows once the stroke has arrived. A leg that comes later, with a new scan,
 * is drawn on its own.
 */
function Legs({ legs, stroke }: Pick<Overlay, 'legs' | 'stroke'>) {
  // Timed once, for the route as it first shows: a camera that moves afterwards must not draw it again.
  const [time] = useState(() => strokeTime(stroke));
  const [drawn, setDrawn] = useState(false);
  return <g className={styles.route} style={{ '--map-stroke-time': `${time}ms` } as CSSProperties}
    onAnimationEnd={(event) => { if (event.target === event.currentTarget) setDrawn(true); }}>
    {legs.map(leg => <Leg key={leg.id} leg={leg} late={drawn} />)}
  </g>;
}

function Leg({ leg: { d, kind, pen }, late }: { leg: Overlay['legs'][number]; late: boolean }) {
  // Whether the stroke had already ended when this leg came.
  const [after] = useState(late);
  return <path d={d} className={styles.leg} data-kind={kind} data-late={after || undefined} pathLength={pen ? 1 : undefined}
    style={pen && { '--pen-from': pen.from.toFixed(4), '--pen-share': pen.share.toFixed(4), '--pen-reach': pen.reach.toFixed(4) } as CSSProperties} />;
}

/** How large a place is marked: the parcel's own place largest, a stop on the way smallest. A quiet route marks them all smaller. */
function dotRadius(kind: Overlay['dots'][number]['kind'], quiet: boolean): number {
  const radius = kind === 'current' ? 5 : kind === 'origin' ? 3.5 : kind === 'stop' ? 2.6 : 4.5;
  return quiet ? radius * .64 : radius;
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
  const { detail, inView, globe, visited } = mapView(camera, size);
  const world = geography(detail);
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

let measure: CanvasRenderingContext2D | null = null;
function textWidth(text: string): number {
  measure ??= document.createElement('canvas').getContext('2d');
  if (!measure) return text.length * 6.5;
  measure.font = LABEL_FONT;
  return measure.measureText(text).width;
}
