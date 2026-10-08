// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pipWidths } from '../../components/map/pipGeometry';
import type { EventPlace, ParcelWithEvents, Stage } from '../../types';
import { journeyMap } from './cardMap';

const SIZE = { width: 456, height: 236 };
const INSETS = { top: 48, right: 18, bottom: 56, left: 18 };
const TINT = { tone: '#6c5419', surface: '#f7e8aa' };

const town = (name: string, country: string, latitude: number, longitude: number): EventPlace => ({ name, country, latitude, longitude, precision: 'city' });
const HAMBURG = town('Hamburg', 'DE', 53.551, 9.993);
const ZURICH = town('Zürich', 'CH', 47.367, 8.55);

function parcel(scans: [stage: Stage, at: string, place?: EventPlace][], destinationCountry?: string): ParcelWithEvents {
  return {
    id: 'p', trackingNumber: 'TESTPARCEL123456', label: 'A private name', carrier: 'dhl', createdAt: '2026-10-01T08:00:00Z', syncStatus: 'ok', destinationCountry,
    events: scans.map(([stage, occurredAt, place], index) => ({ id: `e${index}`, parcelId: 'p', stage, description: 'Signed by ALEX EXAMPLE', location: 'Samplestrasse 1', occurredAt, place })),
  };
}

const draw = (journey: ParcelWithEvents, languageTag = 'en-CH') => journeyMap(journey, languageTag, SIZE, INSETS, TINT);
const circles = (svg: string) => [...svg.matchAll(/<circle [^>]*>/g)].map(([circle]) => circle);

describe('journeyMap', () => {
  it('has nothing to draw for a parcel none of whose scans could be placed', async () => {
    expect(await draw(parcel([['accepted', '2026-10-01T09:00:00Z'], ['delivered', '2026-10-03T12:12:00Z']]))).toBeNull();
    expect(await draw(parcel([]))).toBeNull();
  });

  it('draws the land, the route and its dots, names both ends and gives Pip a place beside the last one', async () => {
    const map = (await draw(parcel([['accepted', '2026-10-01T16:48:00Z', HAMBURG], ['delivered', '2026-10-03T12:12:00Z', ZURICH]])))!;
    expect(map.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="456" height="236" viewBox="0 0 456 236"')).toBe(true);
    // Land in the card's ink, the two countries the parcel passed through a shade darker, borders in its surface.
    expect(map.svg).toMatch(/<path d="M[^"]{2000,}" fill="#6c5419" fill-opacity="\.1"\/>/);
    expect(map.svg).toMatch(/<path d="M[^"]+" fill="#6c5419" fill-opacity="0\.\d+"\/>/);
    expect(map.svg).toMatch(/<path d="M[^"]+" stroke="#f7e8aa" stroke-opacity="\.8" stroke-width="0\.(?:8|55)"\/>/);
    // One leg, bowed as the app draws a short hop; the origin's dot and the parcel's own, ringed in white.
    expect(map.svg.match(/<path d="M[\d.,]+Q[\d., ]+" stroke="#6c5419" stroke-width="1\.8"\/>/g)).toHaveLength(1);
    expect(circles(map.svg)).toEqual([
      expect.stringContaining('r="3.5" fill="#6c5419" stroke="#f7e8aa"'),
      expect.stringContaining('r="5" fill="#6c5419" stroke="#fff" stroke-width="2"'),
    ]);
    expect(map.labels.map(({ text, kind }) => [text, kind])).toEqual([['Zürich', 'current'], ['Hamburg', 'end']]);
    for (const label of map.labels) {
      expect(label.width).toBeGreaterThan(30);
      expect(label.x).toBeGreaterThanOrEqual(INSETS.left);
      expect(label.x + label.width).toBeLessThanOrEqual(SIZE.width - INSETS.right);
    }
    // Pip stands inside the picture, below the card's top row, as large as a delivered parcel allows.
    expect(pipWidths('joy')).toContain(map.pip!.width);
    expect(map.pip!.y).toBeGreaterThanOrEqual(INSETS.top - 24 * map.pip!.width / 300);
    expect(map.pip!.x).toBeGreaterThan(0);
    expect(map.pip!.x + map.pip!.width).toBeLessThan(SIZE.width);
    expect(map.route.countries).toEqual(['DE', 'CH']);
    expect(Math.round(map.route.km)).toBeGreaterThan(600);
  });

  it('keeps the route’s names and Pip off what the card writes over the map', async () => {
    const journey = parcel([['accepted', '2026-10-01T16:48:00Z', HAMBURG], ['delivered', '2026-10-03T12:12:00Z', ZURICH]]);
    const name = (await draw(journey))!.labels.find(({ text }) => text === 'Hamburg')!;
    // A second carrier's mark where Hamburg's name stood.
    const covered = { x: name.x, y: name.y, width: name.width, height: 22 };
    const map = (await journeyMap(journey, 'en-CH', SIZE, INSETS, TINT, { covered }))!;
    expect(map.labels.map(({ text }) => text).sort()).toEqual(['Hamburg', 'Zürich']);
    const apart = (box: { x: number; y: number; width: number; height: number }) => box.x + box.width <= covered.x || box.x >= covered.x + covered.width
      || box.y + box.height <= covered.y || box.y >= covered.y + covered.height;
    for (const label of map.labels) expect(apart({ ...label, height: 22 })).toBe(true);
    expect(apart({ x: map.pip!.x, y: map.pip!.y, width: map.pip!.width, height: map.pip!.width })).toBe(true);
    // A map that starts its route a line lower for the mark keeps Pip's ceiling where it was.
    const lower = (await journeyMap(journey, 'en-CH', { ...SIZE, height: SIZE.height + 24 }, { ...INSETS, top: INSETS.top + 24 }, TINT, { ceiling: INSETS.top, covered }))!;
    expect(lower.svg).toContain('height="260" viewBox="0 0 456 260"');
    expect(lower.labels).toHaveLength(2);
    expect(lower.pip!.y).toBeGreaterThanOrEqual(INSETS.top - 24 * lower.pip!.width / 300);
  });

  it('writes nothing from the parcel but the names of places', async () => {
    const map = (await draw(parcel([['accepted', '2026-10-01T16:48:00Z', HAMBURG], ['delivered', '2026-10-03T12:12:00Z', ZURICH]])))!;
    expect(`${map.svg}${JSON.stringify(map.labels)}`).not.toMatch(/TESTPARCEL|private name|ALEX|Samplestrasse|<text/);
  });

  it('leaves out a name its face cannot write, and keeps the dot', async () => {
    const athens = town('Αθήνα', 'GR', 37.98, 23.73);
    const map = (await draw(parcel([['accepted', '2026-10-01T09:00:00Z', athens], ['delivered', '2026-10-03T12:12:00Z', ZURICH]])))!;
    expect(map.labels.map((label) => label.text)).toEqual(['Zürich']);
    expect(circles(map.svg)).toHaveLength(2);
    expect(map.route.origin?.place.name).toBe('');
  });

  it('shows a long journey on the globe, with its outline and the way still to go', async () => {
    const shenzhen = town('Shenzhen', 'CN', 22.54, 114.06);
    const liege = town('Liège', 'BE', 50.63, 5.57);
    // The delivered scan has no place: the last one known is in Belgium, and the parcel was heading for Switzerland.
    const map = (await draw(parcel([['accepted', '2026-09-20T09:00:00Z', shenzhen], ['in_transit', '2026-09-28T09:00:00Z', liege], ['delivered', '2026-10-03T12:12:00Z']], 'CH'), 'de-CH'))!;
    // The globe's edge, in the card's ink.
    expect(map.svg).toMatch(/<path d="M[^"]+" stroke="#6c5419" stroke-opacity="0\.\d+"\/>/);
    // The stretch to the country it was going to is dashed, and ends in a hollow dot.
    expect(map.svg).toMatch(/stroke-opacity="\.45" stroke-width="1\.4" stroke-dasharray="3 5"/);
    expect(circles(map.svg)).toEqual([
      expect.stringContaining('fill="#f7e8aa" stroke="#6c5419" stroke-opacity=".45"'),
      expect.stringContaining('r="3.5"'),
      expect.stringContaining('r="4.5" fill="#fff" stroke="#6c5419"'),
    ]);
    // The country is named in the reader's language.
    expect(map.route.destination?.name).toBe('Schweiz');
    expect(map.labels.map((label) => label.text)).toEqual(expect.arrayContaining(['Liège', 'Shenzhen']));
  });

  it('draws a close-up with its lakes', async () => {
    const bern = town('Bern', 'CH', 46.948, 7.447);
    const map = (await draw(parcel([['accepted', '2026-10-02T09:00:00Z', bern], ['delivered', '2026-10-03T12:12:00Z', ZURICH]])))!;
    expect(map.svg).toMatch(/<path d="M[^"]+" fill="#f7e8aa"\/>/);
    expect(map.svg).toContain('stroke-width="0.8"');
  });
});
