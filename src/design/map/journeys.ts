import type { CarrierId } from '../../types';
import type { Coordinate } from '../../components/map/geography';
import type { Place, Scan } from '../../components/map/route';

// Fictional parcels at city centres, as a server-side gazetteer would resolve them.
const city = (id: string, name: string, country: string, coordinate: Coordinate): Place => ({ id, name, country, coordinate, precision: 'city' });
// Natural Earth label points, as the map draws countries.
const country = (code: string, name: string, coordinate: Coordinate): Place => ({ id: code, name, country: code, coordinate, precision: 'country' });

const places = {
  kyoto: city('kyoto', 'Kyoto', 'JP', [135.768, 35.012]),
  osaka: city('osaka', 'Osaka', 'JP', [135.502, 34.694]),
  leipzig: city('leipzig', 'Leipzig', 'DE', [12.374, 51.34]),
  basel: city('basel', 'Basel', 'CH', [7.589, 47.56]),
  zurich: city('zurich', 'Zürich', 'CH', [8.541, 47.377]),
  mulligen: city('mulligen', 'Zürich-Mülligen', 'CH', [8.462, 47.389]),
  harkingen: city('harkingen', 'Härkingen', 'CH', [7.818, 47.308]),
  bern: city('bern', 'Bern', 'CH', [7.447, 46.948]),
  buchs: city('buchs', 'Buchs', 'CH', [9.472, 47.166]),
  paris: city('paris', 'Paris', 'FR', [2.352, 48.857]),
  shenzhen: city('shenzhen', 'Shenzhen', 'CN', [114.058, 22.543]),
  hongKong: city('hong-kong', 'Hong Kong', 'HK', [114.169, 22.319]),
  anchorage: city('anchorage', 'Anchorage', 'US', [-149.9, 61.218]),
  louisville: city('louisville', 'Louisville', 'US', [-85.759, 38.253]),
  newYork: city('new-york', 'New York', 'US', [-73.99, 40.693]),
  china: country('CN', 'China', [106.34, 32.5]),
  france: country('FR', 'France', [2.55, 46.7]),
  switzerland: country('CH', 'Switzerland', [7.46, 46.72]),
};

export type JourneyGroup = 'Far' | 'Near' | 'Sparse';

export interface Journey {
  id: string;
  name: string;
  group: JourneyGroup;
  label: string;
  carrier: CarrierId;
  destination?: Place;
  /** The step the study opens on; later scans are still to come. */
  initialStep: number;
  expected: string;
  scans: Scan[];
}

export const journeys: readonly Journey[] = [
  {
    id: 'world', name: 'Across the world', group: 'Far', label: 'Kyoto tea set 🍵', carrier: 'dhl',
    destination: places.switzerland, initialStep: 4, expected: '2026-09-28T12:00:00+02:00',
    scans: [
      { at: '2026-09-22T09:20:00+02:00', description: 'Picked up from the sender', stage: 'accepted', place: places.kyoto },
      { at: '2026-09-23T02:05:00+02:00', description: 'Processed at the export hub', stage: 'in_transit', place: places.osaka },
      { at: '2026-09-23T14:40:00+02:00', description: 'Departed from Japan', stage: 'in_transit' },
      { at: '2026-09-24T06:10:00+02:00', description: 'Arrived at the hub', stage: 'in_transit', place: places.leipzig },
      { at: '2026-09-24T21:35:00+02:00', description: 'Departed from the hub', stage: 'in_transit', place: places.leipzig },
      { at: '2026-09-25T10:30:00+02:00', description: 'Arrived in Switzerland, with customs', stage: 'customs', place: places.basel },
      { at: '2026-09-26T08:15:00+02:00', description: 'Cleared customs', stage: 'in_transit', place: places.basel },
      { at: '2026-09-28T07:55:00+02:00', description: 'Out for delivery', stage: 'out_for_delivery', place: places.zurich },
      { at: '2026-09-28T11:32:00+02:00', description: 'Delivered', stage: 'delivered', place: places.zurich },
    ],
  },
  {
    id: 'pacific', name: 'Over the Pacific', group: 'Far', label: 'Mechanical keyboard ⌨️', carrier: 'ups',
    destination: places.newYork, initialStep: 3, expected: '2026-09-28T18:00:00+02:00',
    scans: [
      { at: '2026-09-23T04:10:00+02:00', description: 'Picked up', stage: 'accepted', place: places.shenzhen },
      { at: '2026-09-23T19:45:00+02:00', description: 'Departed from the facility', stage: 'in_transit', place: places.hongKong },
      { at: '2026-09-24T09:30:00+02:00', description: 'Arrived at the facility', stage: 'in_transit', place: places.anchorage },
      { at: '2026-09-25T03:20:00+02:00', description: 'Processed at the hub', stage: 'in_transit', place: places.louisville },
      { at: '2026-09-28T14:05:00+02:00', description: 'Out for delivery', stage: 'out_for_delivery', place: places.newYork },
    ],
  },
  {
    id: 'regional', name: 'Across the border', group: 'Near', label: 'Linen shirt 👕', carrier: 'la-poste',
    destination: places.zurich, initialStep: 4, expected: '2026-09-29T12:00:00+02:00',
    scans: [
      { at: '2026-09-24T17:40:00+02:00', description: 'Posted', stage: 'accepted', place: places.paris },
      { at: '2026-09-25T06:15:00+02:00', description: 'Left France', stage: 'in_transit', place: places.france },
      { at: '2026-09-26T09:50:00+02:00', description: 'Arrived in Switzerland', stage: 'customs', place: places.basel },
      { at: '2026-09-27T22:10:00+02:00', description: 'Sorted at the parcel centre', stage: 'in_transit', place: places.harkingen },
      { at: '2026-09-28T09:05:00+02:00', description: 'On the way to the delivery office', stage: 'in_transit' },
    ],
  },
  {
    id: 'local', name: 'Close to home', group: 'Near', label: 'Coffee beans ☕', carrier: 'swiss-post',
    destination: places.zurich, initialStep: 2, expected: '2026-09-28T12:00:00+02:00',
    scans: [
      { at: '2026-09-27T15:24:00+02:00', description: 'Posted at the counter', stage: 'accepted', place: places.bern },
      { at: '2026-09-27T23:48:00+02:00', description: 'Sorted at the parcel centre', stage: 'in_transit', place: places.harkingen },
      { at: '2026-09-28T07:40:00+02:00', description: 'Out for delivery', stage: 'out_for_delivery', place: places.zurich },
    ],
  },
  {
    id: 'city', name: 'Across town', group: 'Near', label: 'Birthday card 💌', carrier: 'swiss-post',
    initialStep: 2, expected: '2026-09-28T12:00:00+02:00',
    scans: [
      { at: '2026-09-27T16:02:00+02:00', description: 'Posted at the counter', stage: 'accepted', place: places.zurich },
      { at: '2026-09-27T21:30:00+02:00', description: 'Sorted', stage: 'in_transit', place: places.mulligen },
      { at: '2026-09-28T07:20:00+02:00', description: 'Out for delivery', stage: 'out_for_delivery', place: places.zurich },
    ],
  },
  {
    id: 'point', name: 'One place', group: 'Sparse', label: 'Trail shoes 👟', carrier: 'dpd',
    initialStep: 1, expected: '2026-09-29T12:00:00+02:00',
    scans: [
      { at: '2026-09-27T10:12:00+02:00', description: 'Parcel details received', stage: 'registered' },
      { at: '2026-09-28T05:44:00+02:00', description: 'At the parcel centre', stage: 'in_transit', place: places.buchs },
    ],
  },
  {
    id: 'countries', name: 'Countries only', group: 'Sparse', label: 'Phone case 📱', carrier: 'aliexpress',
    destination: places.switzerland, initialStep: 4, expected: '2026-09-30T12:00:00+02:00',
    scans: [
      { at: '2026-09-15T03:12:00+02:00', description: 'Order shipped', stage: 'accepted' },
      { at: '2026-09-16T11:40:00+02:00', description: 'Left the sorting centre', stage: 'in_transit', place: places.china },
      { at: '2026-09-18T20:05:00+02:00', description: 'Handed to the airline', stage: 'in_transit', place: places.china },
      { at: '2026-09-25T13:25:00+02:00', description: 'Arrived in the destination country', stage: 'customs', place: places.switzerland },
      { at: '2026-09-27T09:10:00+02:00', description: 'With the local carrier', stage: 'in_transit' },
    ],
  },
  {
    id: 'none', name: 'No places', group: 'Sparse', label: '35mm film rolls 🎞️', carrier: 'quickpac',
    initialStep: 1, expected: '2026-09-30T12:00:00+02:00',
    scans: [
      { at: '2026-09-27T18:30:00+02:00', description: 'Parcel announced', stage: 'registered' },
      { at: '2026-09-28T06:05:00+02:00', description: 'Processed', stage: 'in_transit' },
    ],
  },
];
