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
});
