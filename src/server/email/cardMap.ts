import 'server-only';

import { geoPath } from 'd3-geo';
import { projection, type Camera } from '../../components/map/camera';
import { layout, mapView, shownOf, targetCamera, type Insets, type Overlay, type PipPlacing, type Rect, type Size } from '../../components/map/layout';
import { countryPlace, defaultMode, routeFromEvents, type Route } from '../../components/map/route';
import { countryLabel, geography, loadWorld } from '../../components/map/world';
import { countryName } from 'universal-parcel-scraper/app';
import type { ParcelWithEvents } from '../../types';
import { GEIST, textWidth, writable } from '../pictureFont';

/** The size the app writes a place's name in, which the layout's own sums assume. */
export const LABEL_SIZE = 11.5;

export interface JourneyMap {
  route: Route;
  /** The land in view, the route and its dots, as an SVG document of the map's size. */
  svg: string;
  /** The names that found room, each with the box the layout gave it. */
  labels: Overlay['labels'];
  /** Where Pip's frame starts and how wide it is. */
  pip: { x: number; y: number; width: number } | null;
}

/** The card's two colours: its ink and its surface, as `#rrggbb`. */
export interface Tint { tone: string; surface: string }

/**
 * A delivered parcel's journey as the app's card draws it: the same route,
 * camera, names and place for Pip, from the same code, with the land as SVG
 * paths instead of a canvas. Null when no scan could be placed.
 *
 * As on the app's card, Pip may stand as high as `ceiling` (the frame's top
 * unless told), and the route, its names and Pip keep off `covered`, what the
 * card writes over the map below its top row.
 *
 * The world's shapes load here, on the first map: nothing else on the server
 * needs them.
 */
export async function journeyMap(parcel: ParcelWithEvents, languageTag: string, size: Size, insets: Insets, tint: Tint,
  { ceiling = insets.top, covered }: { ceiling?: number; covered?: Rect } = {}): Promise<JourneyMap | null> {
  if (!parcel.events.some((event) => event.place)) return null;
  await loadWorld();
  // A name the picture's face cannot write is left out: the dot stays, unnamed.
  const named = (name: string) => writable(name, GEIST) ?? '';
  const country = (code: string) => named(countryName(code, languageTag));
  const label = parcel.destinationCountry ? countryLabel(parcel.destinationCountry) : null;
  const destination = parcel.destinationCountry && label ? countryPlace(parcel.destinationCountry, country(parcel.destinationCountry), label) : undefined;
  const events = parcel.events.map((event) => event.place ? { ...event, place: { ...event.place, name: named(event.place.name) } } : event);
  const route = routeFromEvents(events, destination, country);
  if (!route.stops.length) return null;

  const mode = defaultMode(route, 'delivered');
  const pip: PipPlacing = { mood: 'joy', ceiling };
  const width = (text: string) => textWidth(text, LABEL_SIZE, GEIST);
  const drawn = (camera: Camera, box?: Rect) =>
    layout(route, camera, size, insets, 'rect', 'ends', false, mode, false, languageTag, pip, width, undefined, box);
  const camera = targetCamera(route, mode, size, insets, 'rect', covered, covered && ((view, box) => shownOf(drawn(view, box))));
  const overlay = drawn(camera, covered);

  const { detail, inView, globe, visited } = mapView(camera, size);
  const world = geography(detail);
  const path = geoPath(projection(camera).clipExtent([[-2, -2], [size.width + 2, size.height + 2]])).digits(1);
  const { tone, surface } = tint;
  const passed = route.countries.flatMap((code) => world.countries.get(code)?.shape ?? []).map((shape) => path(shape) ?? '').join('');
  // The app's card paints its map in the card's own two colours: the ink, thinned, for the land, and the surface for what divides it.
  const shapes = [
    `<path d="${path({ type: 'MultiPolygon', coordinates: inView(world.land) }) ?? ''}" fill="${tone}" fill-opacity=".1"/>`,
    // Countries the parcel passed through, once the view is wide enough to hold several.
    visited > 0 ? `<path d="${passed}" fill="${tone}" fill-opacity="${(.17 * visited).toFixed(3)}"/>` : '',
    detail === 'fine' ? `<path d="${path({ type: 'MultiPolygon', coordinates: inView(world.lakes) }) ?? ''}" fill="${surface}"/>` : '',
    `<path d="${path({ type: 'MultiLineString', coordinates: inView(world.borders) }) ?? ''}" stroke="${surface}" stroke-opacity=".8" stroke-width="${detail === 'fine' ? .8 : .55}"/>`,
    globe > 0 ? `<path d="${path({ type: 'Sphere' }) ?? ''}" stroke="${tone}" stroke-opacity="${(.16 * globe).toFixed(3)}"/>` : '',
    ...overlay.legs.map((leg) => leg.kind === 'remaining' ? `<path d="${leg.d}" stroke="${tone}" stroke-opacity=".45" stroke-width="1.4" stroke-dasharray="3 5"/>`
      : `<path d="${leg.d}" stroke="${tone}" stroke-width="1.8"/>`),
    ...overlay.dots.map(({ x, y, kind }) => {
      const at = `cx="${x.toFixed(1)}" cy="${y.toFixed(1)}"`;
      return kind === 'current' ? `<circle ${at} r="5" fill="${tone}" stroke="#fff" stroke-width="2"/>`
        : kind === 'last-known' ? `<circle ${at} r="4.5" fill="#fff" stroke="${tone}" stroke-width="2"/>`
          : kind === 'destination' ? `<circle ${at} r="4.5" fill="${surface}" stroke="${tone}" stroke-opacity=".45" stroke-width="1.5"/>`
            : kind === 'area' ? `<circle ${at} r="4.5" stroke="${tone}" stroke-width="1.4" stroke-dasharray="1.6 2.4"/>`
              : `<circle ${at} r="${kind === 'origin' ? 3.5 : 2.6}" fill="${tone}" stroke="${surface}" stroke-width="1.5"/>`;
    }),
  ];
  return {
    route,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}" fill="none" stroke-linecap="round" stroke-linejoin="round">${shapes.join('')}</svg>`,
    // A country's name is written in capitals, which the face may lack where it had the small letters.
    labels: overlay.labels.filter((placed) => placed.text && writable(placed.text, GEIST) === placed.text),
    pip: overlay.pip && { x: overlay.pip.x, y: overlay.pip.y, width: overlay.pip.width },
  };
}
