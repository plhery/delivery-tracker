import { describe, expect, it } from 'vitest';
import type { Camera } from './camera';
import { buildRoute, type Place } from './route';
import { layout, mapView, targetCamera } from './layout';
import { loadWorld, type Coordinate, type Part } from './world';

const SIZE = { width: 400, height: 300 };
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
const camera = (scale: number, center: Coordinate = [8.5, 47.4]): Camera => ({ center, scale, offset: [200, 150] });
const part = (center: Coordinate, radius: number): Part<string> => ({ shape: `${center}`, center, radius });
const city = (name: string, country: string, longitude: number, latitude: number): Place => ({ id: name, name, country, coordinate: [longitude, latitude], precision: 'city' });

describe('mapView', () => {
  it('draws fine shapes up close and coarse ones from afar', () => {
    expect(mapView(camera(2_000), SIZE).detail).toBe('fine');
    expect(mapView(camera(600), SIZE).detail).toBe('coarse');
  });

  it('is a flat map up close and a globe from afar, with the countries passed through tinted in between', () => {
    expect(mapView(camera(6_000), SIZE)).toMatchObject({ globe: 0, visited: 0 });
    // 300 px of a 600 px globe span half a radian: 3,185 km, wide enough for several countries.
    expect(mapView(camera(600), SIZE)).toMatchObject({ globe: 0, visited: 1 });
    expect(mapView(camera(150), SIZE)).toMatchObject({ globe: 1, visited: 1 });
    const between = mapView(camera(300), SIZE);
    expect(between.globe).toBeCloseTo((1 - .5) / .9, 6);
  });

  it('keeps only the shapes whose cap reaches the view', () => {
    const near = part([8.5, 47.4], .01);
    const far = part([139.7, 35.7], .01);
    const wide = part([100, 40], 2);
    expect(mapView(camera(6_000), SIZE).inView([near, far, wide])).toEqual([near.shape, wide.shape]);
    // From afar the whole hemisphere is in view, Tokyo at its edge, and not the other side of the Earth.
    expect(mapView(camera(150), SIZE).inView([near, far, part([-171.5, -47.4], .01)])).toEqual([near.shape, far.shape]);
  });
});

describe('layout', () => {
  it('measures names with the face it is given, and says how wide each one is', async () => {
    await loadWorld();
    const route = buildRoute([
      { at: '2026-09-28T10:00:00Z', description: 'Scan', stage: 'accepted', place: city('Hamburg', 'DE', 9.99, 53.55) },
      { at: '2026-09-29T10:00:00Z', description: 'Scan', stage: 'delivered', place: city('Zürich', 'CH', 8.55, 47.37) },
    ]);
    const frame = targetCamera(route, 'journey', SIZE, NO_INSETS, 'rect');
    const narrow = layout(route, frame, SIZE, NO_INSETS, 'rect', 'ends', false, 'journey', false, 'en', null, (text) => text.length * 5);
    const wide = layout(route, frame, SIZE, NO_INSETS, 'rect', 'ends', false, 'journey', false, 'en', null, (text) => text.length * 10);
    expect(narrow.labels.map(({ text, width }) => [text, width])).toEqual([['Zürich', 6 * 5 + 14], ['Hamburg', 7 * 5 + 14]]);
    expect(wide.labels.map(({ text, width }) => [text, width])).toEqual([['Zürich', 6 * 10 + 14], ['Hamburg', 7 * 10 + 14]]);
    expect(narrow.pip).toBeNull();
    expect(narrow.legs).toHaveLength(1);
  });

  const scan = (place: Place, stage: 'in_transit' | 'out_for_delivery' = 'in_transit') => ({ at: '2026-09-28T10:00:00Z', description: 'Scan', stage, place });
  const lyon = city('Lyon', 'FR', 4.84, 45.76);
  const bern = city('Bern', 'CH', 7.45, 46.95);
  const zurich = city('Zürich', 'CH', 8.55, 47.37);
  const overlay = (route: ReturnType<typeof buildRoute>, mode: 'journey' | 'now') => layout(route, targetCamera(route, mode, SIZE, NO_INSETS, 'rect'), SIZE,
    NO_INSETS, 'rect', 'ends', false, mode, false, 'en', null, (text) => text.length * 6);

  it('gives each leg its turn in the one stroke that draws the route, for as long as its length in the frame', async () => {
    await loadWorld();
    const germany: Place = { id: 'DE', name: 'Germany', country: 'DE', coordinate: [10.4, 51.1], precision: 'country' };
    const { legs, stroke } = overlay(buildRoute([scan(lyon), scan(bern), scan(zurich), scan(germany)], city('Oslo', 'NO', 10.75, 59.91)), 'journey');
    expect(legs.map((leg) => leg.kind)).toEqual(['remaining', 'travelled', 'travelled', 'approximate']);
    // The way still to go is not part of the stroke; the others follow each other from the first place to the parcel's.
    const [remaining, ...drawn] = legs;
    expect(remaining.pen).toBeUndefined();
    const pens = drawn.map((leg) => leg.pen!);
    expect(pens[0].from).toBe(0);
    expect(pens[1].from).toBeCloseTo(pens[0].share, 9);
    expect(pens[2].from).toBeCloseTo(pens[0].share + pens[1].share, 9);
    expect(pens[2].from + pens[2].share).toBeCloseTo(1, 9);
    // Lyon to Bern is about three times as far as Bern to Zürich, and takes about three times as long.
    expect(pens[0].share / pens[1].share).toBeGreaterThan(2.3);
    expect(pens[0].share / pens[1].share).toBeLessThan(3.7);
    // All of it is in the frame, so every leg is drawn from its start.
    expect(pens.map((pen) => pen.reach)).toEqual([1, 1, 1]);
    expect(stroke).toBeGreaterThan(100);
    expect(stroke).toBeLessThan(SIZE.width + SIZE.height);
  });

  it('starts the stroke where the route enters a close-up, and spends no time outside it', async () => {
    await loadWorld();
    const route = buildRoute([scan(city('Kyoto', 'JP', 135.77, 35.01)), scan(city('Hamburg', 'DE', 9.99, 53.55)), scan(bern), scan(zurich, 'out_for_delivery')]);
    const { legs, stroke } = overlay(route, 'now');
    const [far, entering, close] = legs.map((leg) => leg.pen!);
    // Kyoto to Hamburg is nowhere near the last mile: it takes a moment and has nothing left to draw.
    expect(far.share).toBeLessThan(.02);
    expect(far.reach).toBe(0);
    // Hamburg to Bern comes in over the edge: only what the frame shows is left to draw, and only that takes time.
    expect(entering.reach).toBeGreaterThan(0);
    expect(entering.reach).toBeLessThan(.6);
    expect(close.reach).toBe(1);
    expect(entering.share + close.share).toBeGreaterThan(.98);
    expect(stroke).toBeLessThan(SIZE.width + SIZE.height);
  });

  it('measures a long leg as its line is drawn: cut a little outside the frame', async () => {
    await loadWorld();
    const { legs: [leg] } = overlay(buildRoute([scan(city('Kyoto', 'JP', 135.77, 35.01)), scan(zurich, 'out_for_delivery')]), 'now');
    // The drawn line, point by point: how much of it lies in the frame is what the stroke has left to draw.
    const points = leg.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    let whole = 0;
    let shown = 0;
    for (let index = 2; index < points.length; index += 2) {
      const [x1, y1, x2, y2] = points.slice(index - 2, index + 2);
      for (let step = 0; step < 100; step += 1) {
        const x = x1 + (x2 - x1) * (step + .5) / 100;
        const y = y1 + (y2 - y1) * (step + .5) / 100;
        whole += Math.hypot(x2 - x1, y2 - y1) / 100;
        if (x >= 0 && x <= SIZE.width && y >= 0 && y <= SIZE.height) shown += Math.hypot(x2 - x1, y2 - y1) / 100;
      }
    }
    expect(shown).toBeGreaterThan(50);
    expect(whole - shown).toBeGreaterThan(300);
    expect(leg.pen!.reach).toBeCloseTo(shown / whole, 2);
  });

  it('has no stroke to draw before the parcel has travelled', async () => {
    await loadWorld();
    const { legs, stroke } = overlay(buildRoute([scan(lyon)], zurich), 'journey');
    expect(legs.map((leg) => leg.kind)).toEqual(['remaining']);
    expect(stroke).toBe(0);
  });
});

describe('layout of the opened map', () => {
  const width = (text: string) => text.length * 6;
  const WIDE = { width: 800, height: 600 };
  const zurich = city('Zürich', 'CH', 8.55, 47.37);
  const at = (place: Place) => ({ at: '2026-09-28T10:00:00Z', description: 'Scan', stage: 'in_transit' as const, place });
  /** A view `kilometres` across its shorter side, around Zürich. */
  const close = (kilometres: number, size = WIDE): Camera => ({ center: [8.55, 47.37], scale: size.height / (kilometres / 6371), offset: [size.width / 2, size.height / 2] });
  const town = (name: string, longitude: number, latitude: number, thousands: number) => ({ coordinate: [longitude, latitude] as Coordinate, name, thousands });
  const towns = [town('Winterthur', 8.72, 47.5, 112), town('Zug', 8.52, 47.17, 31), town('Rapperswil', 8.82, 47.23, 27), town('Baden', 8.31, 47.47, 19)];
  const bearings = (route: ReturnType<typeof buildRoute>, kilometres: number, given?: typeof towns, size = WIDE) =>
    layout(route, close(kilometres, size), size, NO_INSETS, 'rect', 'all', true, 'now', true, 'en', null, width, given)
      .labels.filter(label => label.kind === 'city').map(label => label.text);

  it('names smaller towns the closer the view, and none on a map without close-ups', async () => {
    await loadWorld();
    const route = buildRoute([at(zurich)]);
    expect(bearings(route, 500, towns)).not.toContain('Winterthur');
    expect(bearings(route, 300, towns)).toContain('Winterthur');
    expect(bearings(route, 300, towns)).not.toContain('Zug');
    expect(bearings(route, 200, towns)).toEqual(expect.arrayContaining(['Winterthur', 'Zug', 'Rapperswil']));
    expect(bearings(route, 200, towns)).not.toContain('Baden');
    expect(bearings(route, 100, towns)).toEqual(expect.arrayContaining(['Winterthur', 'Zug', 'Rapperswil', 'Baden']));
    // A map that was given no towns names the large cities, a few of them, as before.
    expect(bearings(route, 100)).toEqual(['Luzern']);
    expect(bearings(route, 300).length).toBeLessThanOrEqual(7);
    expect(bearings(route, 300, []).length).toBeGreaterThan(7);
  });

  it('leaves a place the parcel passed through to its own name', async () => {
    await loadWorld();
    const mulligen: Place = { ...city('Zürich', 'CH', 8.49, 47.39), id: 'mulligen', site: 'Zürich-Mülligen' };
    const route = buildRoute([at(city('Regensdorf', 'CH', 8.47, 47.43)), at(mulligen)]);
    const given = [...towns, town('Regensdorf', 8.468, 47.434, 18), town('Zürich', 8.55, 47.37, 400), town('Zürich-Mülligen', 8.6, 47.4, 20), town('Adliswil', 8.52, 47.31, 19)];
    const names = bearings(route, 60, given);
    // The town of a stop, by its place or by either of its names; a town of its own a few kilometres on is named.
    expect(names).not.toContain('Regensdorf');
    expect(names).not.toContain('Zürich');
    expect(names).not.toContain('Zürich-Mülligen');
    expect(names).toContain('Adliswil');
  });

  it('names as many places as the map has room for', async () => {
    await loadWorld();
    const route = buildRoute([at(zurich)]);
    const many = Array.from({ length: 60 }, (_, index) => town(`Town ${index}`, 8.05 + (index % 10) * .1, 47.05 + Math.floor(index / 10) * .11, 60 - index));
    const small = { width: 400, height: 300 };
    const few = bearings(route, 100, many, small);
    const more = bearings(route, 120, many, { width: 1200, height: 900 });
    // 400 × 300 has room for eight names; a screen nine times the size stops at twenty-four.
    expect(few.length).toBeGreaterThan(4);
    expect(few.length).toBeLessThanOrEqual(8);
    expect(more).toHaveLength(24);
    // The largest towns are the first to be named.
    expect(few).toContain('Town 0');
  });

  it('stands Pip clear of what covers the map, and keeps his spot while the map is moved under him', async () => {
    await loadWorld();
    const size = { width: 400, height: 300 };
    const route = buildRoute([at(city('Hamburg', 'DE', 9.99, 53.55)), at(zurich)]);
    const insets = { top: 40, right: 10, bottom: 120, left: 130 };
    const show = (view: Camera, pip: Parameters<typeof layout>[10]) => layout(route, view, size, insets, 'rect', 'all', true, 'now', true, 'en', pip, width);
    const dot = (overlay: ReturnType<typeof show>) => overlay.dots.find(mark => mark.kind === 'current')!;
    const view: Camera = { ...close(300, size), offset: [280, 110] };
    const first = show(view, { mood: 'look', inset: true });
    const pip = first.pip!;
    expect(pip.x - dot(first).x).toBeCloseTo(pip.dx, 9);
    expect(pip.y - dot(first).y).toBeCloseTo(pip.dy, 9);
    // Inside the room the summary and the buttons leave.
    const unit = pip.width / 300;
    expect(pip.x + 52 * unit).toBeGreaterThanOrEqual(insets.left + 4);
    expect(pip.x + 248 * unit).toBeLessThanOrEqual(size.width - insets.right - 4);
    expect(pip.y + 92 * unit).toBeGreaterThanOrEqual(insets.top);
    expect(pip.y + 288 * unit).toBeLessThanOrEqual(size.height - insets.bottom);
    // Moved a little, he moves with the dot, wherever the best spot would now be.
    const held = { dx: pip.dx, dy: pip.dy, width: pip.width, side: pip.side, below: pip.below };
    const moved = show({ ...view, offset: [300, 120] }, { mood: 'look', inset: true, held });
    expect(moved.pip).toMatchObject({ ...held, x: dot(moved).x + pip.dx, y: dot(moved).y + pip.dy });
    // Moved until he would stand past the room there is, he steps out, where a Pip who had just come would pick the other side.
    const edge: Camera = { ...view, offset: [pip.dx + 150 * unit >= 0 ? 388 : 132, 110] };
    expect(show(edge, { mood: 'look', inset: true, held }).pip).toBeNull();
    expect(show(edge, { mood: 'look', inset: true }).pip).not.toBeNull();
  });
});
