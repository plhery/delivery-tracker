import { geoInterpolate } from 'd3-geo';
import { describe, expect, it } from 'vitest';
import { angularExtent, easeInOut, fitCamera, interpolateCamera, projection, subsolarPoint, type Box } from './camera';
import type { Coordinate } from './geography';

const box: Box = { x: 20, y: 20, width: 360, height: 260 };
const kyoto: Coordinate = [135.77, 35.01];
const zurich: Coordinate = [8.54, 47.38];

function inside(point: [number, number] | null, area: Box = box) {
  return point !== null && point[0] >= area.x - 1 && point[0] <= area.x + area.width + 1
    && point[1] >= area.y - 1 && point[1] <= area.y + area.height + 1;
}

describe('fitCamera', () => {
  it('frames every point inside the box', () => {
    const camera = fitCamera([kyoto, zurich], box, { shape: 'rect', minSpanKm: 400 });
    const project = projection(camera);
    expect(inside(project(kyoto))).toBe(true);
    expect(inside(project(zurich))).toBe(true);
    expect(camera.scale).toBeGreaterThan(150);
  });

  it('gives a single town some surroundings', () => {
    const camera = fitCamera([zurich], box, { shape: 'rect', minSpanKm: 260 });
    const [x, y] = projection(camera)(zurich)!;
    expect(x).toBeCloseTo(200, 0);
    expect(y).toBeCloseTo(150, 0);
    // 260 km across the short side of the box.
    expect(260 / 6371 * camera.scale).toBeCloseTo(260, -1);
  });

  it('fits a circle and falls back to the whole globe for opposite sides of the Earth', () => {
    const circle = fitCamera([kyoto, zurich], box, { shape: 'circle', minSpanKm: 400 });
    expect(circle.scale).toBeGreaterThan(0);
    const globe = fitCamera([[0, 10], [179, -10]], box, { shape: 'rect', minSpanKm: 400 });
    expect(globe.scale).toBeCloseTo(130 * .94, 5);
    expect(globe.offset).toEqual([200, 150]);
  });

  it('looks at a long route from the equator side, so it bows toward the pole', () => {
    const flat = fitCamera([kyoto, zurich], box, { shape: 'rect', minSpanKm: 400 });
    const tilted = fitCamera([kyoto, zurich], box, { shape: 'rect', minSpanKm: 400, tilt: true });
    expect(tilted.center[1]).toBeLessThan(flat.center[1]);
    const project = projection(tilted);
    const middle = project(geoInterpolate(kyoto, zurich)(.5) as Coordinate)!;
    const [kx, ky] = project(kyoto)!;
    const [zx, zy] = project(zurich)!;
    // The arc's middle rises above the straight line between its ends.
    expect(middle[1]).toBeLessThan(ky + (zy - ky) * (middle[0] - kx) / (zx - kx));
    const single = fitCamera([zurich], box, { shape: 'rect', minSpanKm: 400, tilt: true }).center;
    expect(single[0]).toBeCloseTo(zurich[0], 6);
    expect(single[1]).toBeCloseTo(zurich[1], 6);
  });
});

describe('camera motion', () => {
  it('flies between cameras and widens the view on long moves', () => {
    const from = fitCamera([zurich], box, { shape: 'rect', minSpanKm: 200 });
    const to = fitCamera([kyoto], box, { shape: 'rect', minSpanKm: 200 });
    const fly = interpolateCamera(from, to, 400);
    expect(fly(0).scale).toBeCloseTo(from.scale, 5);
    expect(fly(1).center[0]).toBeCloseTo(kyoto[0], 5);
    expect(fly(.5).scale).toBeLessThan(Math.min(from.scale, to.scale));
    const near = interpolateCamera(from, { ...from, offset: [210, 150] }, 400);
    expect(near(.5).scale).toBeCloseTo(from.scale, 5);
    expect([easeInOut(0), easeInOut(.25), easeInOut(.5), easeInOut(1)]).toEqual([0, .0625, .5, 1]);
    expect(angularExtent([zurich, kyoto])).toBeGreaterThan(1.4);
  });
});

describe('subsolarPoint', () => {
  it('puts the sun over the Greenwich meridian at noon and over the tropics at the solstices', () => {
    expect(subsolarPoint(new Date('2026-06-21T12:00:00Z'))[0]).toBeCloseTo(0, 5);
    expect(subsolarPoint(new Date('2026-06-21T12:00:00Z'))[1]).toBeGreaterThan(23);
    // ±180° is the same meridian.
    expect(Math.abs(subsolarPoint(new Date('2026-12-21T00:00:00Z'))[0])).toBeCloseTo(180, 5);
    expect(subsolarPoint(new Date('2026-12-21T00:00:00Z'))[1]).toBeLessThan(-23);
  });
});
