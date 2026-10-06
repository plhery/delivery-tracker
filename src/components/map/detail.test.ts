import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Camera } from './camera';
import { decodeTile, detailRead, levelStrengths, loadDetail, noDetail, onDetailLoaded, paintDetail, spanKm, tilesInView } from './detail';
import index from './detail.json';

const SIZE = { width: 400, height: 300 };
/** A camera over Zürich whose view is `kilometres` across its shorter side. */
const camera = (kilometres: number, center: [number, number] = [8.5, 47.4]): Camera => ({ center, scale: SIZE.height / (kilometres / 6371), offset: [200, 150] });
const degrees = (points: Float64Array, at: number) => [
  Math.atan2(points[at * 3 + 1], points[at * 3]) * 180 / Math.PI,
  Math.asin(points[at * 3 + 2]) * 180 / Math.PI,
];
// The Limmat, more or less: a river in three points, the last on the edge of its tile.
const file = {
  rivers: [[1, 8540, 47370, -140, 40, -1600, 2590]],
  lakes: [[0, 8540, 47360, 180, -110, -40, -60, -160, 130]],
  urban: [[0, 8450, 47340, 180, 0, 0, 90, -180, 0]],
  roads: [[0, 8300, 47400, 400, 20], [2, 8500, 47300, 60, 60]],
  towns: [[8724, 47506, 'Winterthur', 112], [8717, 47348, 'Uster', 35]] as [number, number, string, number][],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('map tiles', () => {
  it('reads a tile: each shape a level and its points, each town a place', () => {
    const tile = decodeTile(file, 1000);
    const [river] = tile.rivers;
    expect(river.level).toBe(1);
    expect(river.points).toHaveLength(9);
    expect(degrees(river.points, 0)[0]).toBeCloseTo(8.54, 6);
    expect(degrees(river.points, 0)[1]).toBeCloseTo(47.37, 6);
    expect(degrees(river.points, 2)[0]).toBeCloseTo(6.8, 6);
    expect(degrees(river.points, 2)[1]).toBeCloseTo(50, 6);
    // Only the point on the tile's edge is one the river was cut at.
    expect([...river.cut]).toEqual([0, 0, 1]);
    // The cap around it reaches every point, and no further than the river is long.
    expect(river.radius).toBeGreaterThan(.02);
    expect(river.radius).toBeLessThan(.06);
    expect(Math.hypot(...river.center)).toBeCloseTo(1, 9);
    expect(tile.towns).toEqual([
      { coordinate: [8.724, 47.506], name: 'Winterthur', thousands: 112 },
      { coordinate: [8.717, 47.348], name: 'Uster', thousands: 35 },
    ]);
    expect(decodeTile({} as typeof file)).toEqual({ rivers: [], lakes: [], urban: [], roads: [], towns: [] });
  });

  it('asks for the tiles of a close-up only', () => {
    expect(spanKm(camera(300), SIZE)).toBeCloseTo(300, 6);
    expect(tilesInView(camera(800), SIZE)).toEqual([]);
    // 300 km across, around Zürich, reaches into the tile to the east; half as wide, around Bern, one tile holds it.
    expect(tilesInView(camera(300), SIZE)).toEqual(['37_27', '38_27']);
    expect(tilesInView(camera(150, [7.5, 47]), SIZE)).toEqual(['37_27']);
    // Further north the same view reaches into the next row.
    expect(tilesInView(camera(150, [7.5, 49.7]), SIZE)).toEqual(['37_27', '37_28']);
    // The open ocean has no tiles.
    expect(tilesInView(camera(300, [-150, -40]), SIZE)).toEqual([]);
    // At the date line the view reaches both ends of the world.
    expect(tilesInView(camera(500, [179.9, -17]), SIZE)).toEqual(['0_15', '71_14']);
  });

  it('brings each level in as the view closes in', () => {
    expect(levelStrengths(700)).toEqual([0, 0, 0]);
    expect(levelStrengths(500)).toEqual([.5, 0, 0]);
    expect(levelStrengths(360)).toEqual([1, .5, 0]);
    expect(levelStrengths(200)).toEqual([1, 1, .5]);
    expect(levelStrengths(60)).toEqual([1, 1, 1]);
  });

  it('lists every tile it ships, and ships every tile it lists', () => {
    const folder = join(process.cwd(), 'public', 'atlas');
    expect(readdirSync(folder).map(name => name.replace(/\.bin$/, '')).sort()).toEqual([...index.tiles].sort());
    const tile = decodeTile(JSON.parse(inflateRawSync(readFileSync(join(folder, '37_27.bin'))).toString('utf8')));
    expect(tile.towns.map(town => town.name)).toEqual(expect.arrayContaining(['Winterthur', 'Konstanz']));
    // The largest towns come first, and the cities the wide map names are left to it.
    expect(tile.towns.map(town => town.thousands)).toEqual([...tile.towns.map(town => town.thousands)].sort((a, b) => b - a));
    expect(tile.towns.map(town => town.name)).not.toContain('Zürich');
    for (const layer of ['rivers', 'lakes', 'urban', 'roads'] as const) {
      expect(tile[layer].length).toBeGreaterThan(10);
      expect(tile[layer].map(shape => shape.level)).toEqual([...tile[layer].map(shape => shape.level)].sort());
    }
  });
});

describe('painting a close-up', () => {
  function recorder() {
    const calls: [string, ...number[]][] = [];
    const state: Record<string, unknown> = {};
    const context = new Proxy(state, {
      get: (target, key: string) => key in target ? target[key] : (...values: number[]) => { calls.push([key, ...values]); },
      set: (target, key: string, value) => {
        target[key] = value;
        if (key === 'globalCompositeOperation' || key === 'globalAlpha') calls.push([`${key}=${value}`]);
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return { calls, context, named: (name: string) => calls.filter(([call]) => call === name) };
  }
  const colors = { water: '#fff', urban: '#ccc', road: '#999' };

  it('draws nothing while the view is wide, or before a tile has come', () => {
    const { calls, context } = recorder();
    paintDetail(context, [decodeTile(file, 1000)], camera(700), SIZE, colors, false);
    paintDetail(context, [], camera(200), SIZE, colors, false);
    expect(calls).toEqual([]);
  });

  it('fills built-up areas and lakes, strokes roads and rivers, each level as strongly as it shows', () => {
    const { calls, context, named } = recorder();
    paintDetail(context, [decodeTile(file, 1000)], camera(360), SIZE, colors, false);
    // Built-up areas, the main road, the river at half strength, then the lake: the small road waits for a closer view.
    expect(named('fill')).toHaveLength(2);
    expect(named('stroke')).toHaveLength(2);
    expect(calls.map(([call]) => call).filter(call => call.startsWith('globalAlpha'))).toContain('globalAlpha=0.5');
    expect(named('moveTo')).toHaveLength(4);
    // Corners are rounded, but for the point where the river was cut at its tile's edge.
    expect(named('quadraticCurveTo').length).toBeGreaterThan(4);
    const closer = recorder();
    paintDetail(closer.context, [decodeTile(file, 1000)], camera(150), SIZE, colors, false);
    expect(closer.named('stroke')).toHaveLength(3);
    expect(closer.named('moveTo')).toHaveLength(5);
  });

  it('skips what the view cannot hold, and cuts water out of a see-through map', () => {
    const away = recorder();
    paintDetail(away.context, [decodeTile(file, 1000)], camera(100, [2.35, 48.86]), SIZE, colors, false);
    expect(away.named('moveTo')).toEqual([]);
    expect(away.named('fill')).toEqual([]);
    const { calls, context } = recorder();
    paintDetail(context, [decodeTile(file, 1000)], camera(150), SIZE, colors, true);
    expect(calls.map(([call]) => call)).toEqual(expect.arrayContaining(['globalCompositeOperation=destination-out', 'globalCompositeOperation=source-over']));
  });

  it('draws a line once where its points fall on one another', () => {
    // A road of many points a few metres apart, 150 km wide on 300 px.
    const road = [0, 8500, 47400, ...Array.from({ length: 40 }, () => [1, 0]).flat()];
    const { named, context } = recorder();
    paintDetail(context, [decodeTile({ ...file, rivers: [], lakes: [], urban: [], roads: [road] }, 1000)], camera(150), SIZE, colors, false);
    expect(named('moveTo')).toHaveLength(1);
    expect(named('quadraticCurveTo').length).toBeLessThan(6);
  });
});

describe('loading tiles', () => {
  const body = () => new Response(deflateRawSync(Buffer.from(JSON.stringify(file))));

  it('reads a tile once from the site itself, and tells who listens', async () => {
    const fetched = vi.fn(async () => body());
    vi.stubGlobal('fetch', fetched);
    const listener = vi.fn();
    const stop = onDetailLoaded(listener);
    const before = detailRead();
    loadDetail(['37_27', '37_27', 'nowhere']);
    loadDetail(['37_27']);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(fetched).toHaveBeenCalledWith(`/atlas/37_27.bin?v=${index.version}`);
    // A new map each time a tile has come, so a view knows to draw again.
    expect(detailRead()).not.toBe(before);
    expect(detailRead().get('37_27')!.towns[0].name).toBe('Winterthur');
    loadDetail(['37_27']);
    expect(fetched).toHaveBeenCalledTimes(1);
    stop();
    expect(noDetail().size).toBe(0);
  });

  it('asks again later for a tile it could not read', async () => {
    vi.useFakeTimers();
    const fetched = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetched);
    loadDetail(['37_28']);
    await vi.advanceTimersByTimeAsync(1_000);
    loadDetail(['37_28']);
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(detailRead().has('37_28')).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    loadDetail(['37_28']);
    expect(fetched).toHaveBeenCalledTimes(2);
  });

  it('keeps the tiles shown last when it has read many', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => body()));
    const keys = index.tiles.filter(key => key !== '37_27').slice(0, 20);
    for (const key of keys) {
      loadDetail([key]);
      await vi.waitFor(() => expect(detailRead().has(key)).toBe(true));
      // The first tile is shown again and again, so it is never the oldest.
      loadDetail([keys[0]]);
    }
    expect(detailRead().size).toBe(16);
    expect(detailRead().has(keys[0])).toBe(true);
    expect(detailRead().has(keys[1])).toBe(false);
    expect(detailRead().has(keys[19])).toBe(true);
  });

  it('stays quiet where tiles cannot be read at all', () => {
    vi.stubGlobal('DecompressionStream', undefined);
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    loadDetail(['37_29']);
    expect(fetched).not.toHaveBeenCalled();
  });
});
