export type Coordinate = readonly [longitude: number, latitude: number];

export interface JourneyStop {
  id: string;
  city: string;
  country: string;
  countryCode: string;
  coordinate: Coordinate;
  date: string;
  time: string;
  description: string;
}

export interface JourneyScenario {
  id: string;
  name: string;
  label: string;
  carrier: string;
  status: string;
  arrival: string;
  stops: readonly JourneyStop[];
  latestHasLocation: boolean;
}

// Fictional scans at city centers. These are design fixtures, never account data.
const shenzhen: JourneyStop = { id: 'shenzhen', city: 'Shenzhen', country: 'China', countryCode: 'CN', coordinate: [114.06, 22.54], date: 'Monday', time: '09:12', description: 'Collected from the sender' };
const singapore: JourneyStop = { id: 'singapore', city: 'Singapore', country: 'Singapore', countryCode: 'SG', coordinate: [103.82, 1.35], date: 'Tuesday', time: '18:40', description: 'Processed at the export hub' };
const frankfurt: JourneyStop = { id: 'frankfurt', city: 'Frankfurt', country: 'Germany', countryCode: 'DE', coordinate: [8.68, 50.11], date: 'Yesterday', time: '06:24', description: 'Arrived at the transit hub' };
const zurich: JourneyStop = { id: 'zurich', city: 'Zürich', country: 'Switzerland', countryCode: 'CH', coordinate: [8.54, 47.38], date: 'Today', time: '08:16', description: 'Import customs cleared' };
const harkingen: JourneyStop = { id: 'harkingen', city: 'Härkingen', country: 'Switzerland', countryCode: 'CH', coordinate: [7.82, 47.31], date: 'Today', time: '10:42', description: 'Sorted at the parcel center' };
const milan: JourneyStop = { id: 'milan', city: 'Milan', country: 'Italy', countryCode: 'IT', coordinate: [9.19, 45.46], date: 'Yesterday', time: '09:12', description: 'Collected from the sender' };
const chiasso: JourneyStop = { id: 'chiasso', city: 'Chiasso', country: 'Switzerland', countryCode: 'CH', coordinate: [9.03, 45.83], date: 'Yesterday', time: '17:36', description: 'Crossed the border' };
const bern: JourneyStop = { id: 'bern', city: 'Bern', country: 'Switzerland', countryCode: 'CH', coordinate: [7.45, 46.95], date: 'Yesterday', time: '15:24', description: 'Collected from the roastery' };

export const journeyScenarios: readonly JourneyScenario[] = [
  { id: 'world', name: 'Across the world', label: 'Studio headphones', carrier: 'DHL', status: 'On the way', arrival: 'Expected tomorrow', stops: [shenzhen, singapore, frankfurt, zurich, harkingen], latestHasLocation: true },
  { id: 'regional', name: 'Across the border', label: 'Linen bedding', carrier: 'Swiss Post', status: 'On the way', arrival: 'Expected tomorrow', stops: [milan, chiasso, harkingen], latestHasLocation: true },
  { id: 'local', name: 'Close to home', label: 'Freshly roasted coffee', carrier: 'Swiss Post', status: 'Out for delivery', arrival: 'Expected today', stops: [bern, harkingen, { ...zurich, description: 'With the local delivery round' }], latestHasLocation: true },
  { id: 'one-stop', name: 'One known stop', label: 'A new favourite', carrier: 'DHL', status: 'On the way', arrival: 'Waiting for an estimate', stops: [shenzhen], latestHasLocation: false },
  { id: 'no-location', name: 'No locations yet', label: 'A little something', carrier: 'Swiss Post', status: 'Label created', arrival: 'Waiting for the first scan', stops: [], latestHasLocation: false },
];

export function flag(code: string): string {
  return [...code].map(letter => String.fromCodePoint(letter.charCodeAt(0) + 127397)).join('');
}
