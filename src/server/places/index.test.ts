import { describe, expect, it } from 'vitest';
import { locatePlace, placesForEvents } from './index';

const place = (location: string, countries?: string[]) => locatePlace(location, { countries });

function expectPlace(location: string, expected: { country: string; name: string; latitude: number; longitude: number }, countries?: string[]) {
  const found = place(location, countries);
  expect(found, location).toMatchObject({ precision: 'city', country: expected.country, name: expected.name });
  expect(found!.latitude, location).toBeCloseTo(expected.latitude, 1);
  expect(found!.longitude, location).toBeCloseTo(expected.longitude, 1);
}

describe('locatePlace', () => {
  it('reads the formats carriers print, with or without a country', () => {
    const zurich = { country: 'CH', name: 'Zürich', latitude: 47.37, longitude: 8.55 };
    for (const location of ['ZUERICH, CH', 'ZUERICH CH', 'ZURICH']) expectPlace(location, zurich);
    // Mixed case is the carrier's own spelling, and the journal shows the same.
    expectPlace('Zurich, CH', { ...zurich, name: 'Zurich' });
    expectPlace('Switzerland Zurich', { ...zurich, name: 'Zurich' });
    expectPlace('Urdorf, CH', { country: 'CH', name: 'Urdorf', latitude: 47.39, longitude: 8.43 });
    expectPlace('KOELN, DE', { country: 'DE', name: 'Köln', latitude: 50.93, longitude: 6.95 });
    expectPlace('SEOUL, KR', { country: 'KR', name: 'Seoul', latitude: 37.57, longitude: 126.98 });
    expectPlace('Paris, Île-de-France, FR', { country: 'FR', name: 'Paris', latitude: 48.85, longitude: 2.35 });
    expectPlace('LONDON', { country: 'GB', name: 'London', latitude: 51.51, longitude: -0.13 });
    expectPlace('BARCELONA2', { country: 'ES', name: 'Barcelona', latitude: 41.39, longitude: 2.16 });
  });

  it('uses states and provinces to pick the right town of a shared name', () => {
    expectPlace('LAUREL, MD 20707', { country: 'US', name: 'Laurel', latitude: 39.1, longitude: -76.85 });
    expectPlace('WASHINGTON, DC 20212', { country: 'US', name: 'Washington', latitude: 38.9, longitude: -77.04 });
    expectPlace('Calgary, AB, CA', { country: 'CA', name: 'Calgary', latitude: 51.05, longitude: -114.09 });
    expectPlace('OTTAWA, ON', { country: 'CA', name: 'Ottawa', latitude: 45.41, longitude: -75.7 });
    expectPlace('Sausheim 68 (68)', { country: 'FR', name: 'Sausheim', latitude: 47.79, longitude: 7.37 });
    expectPlace('Buchs AG', { country: 'CH', name: 'Buchs', latitude: 47.39, longitude: 8.08 }, ['CH']);
  });

  it('looks past facility words to the town', () => {
    expectPlace('Agence DPD de La Crau (283)', { country: 'FR', name: 'La Crau', latitude: 43.15, longitude: 6.07 });
    expectPlace('AGENCE PARIS', { country: 'FR', name: 'Paris', latitude: 48.85, longitude: 2.35 });
    expectPlace('Zürich-Mülligen', { country: 'CH', name: 'Zürich', latitude: 47.37, longitude: 8.55 });
    expect(place('Centre de tri DPD de Le Coudray (175)', ['FR'])).toMatchObject({ country: 'FR', name: 'Le Coudray' });
  });

  it('finds small Swiss towns and postcodes when the parcel is in Switzerland', () => {
    expectPlace('Härkingen 4622', { country: 'CH', name: 'Härkingen', latitude: 47.3, longitude: 7.82 }, ['CH', 'LI']);
    expectPlace('Dintikon', { country: 'CH', name: 'Dintikon', latitude: 47.36, longitude: 8.22 }, ['CH']);
    expectPlace('Buchs SG 9470', { country: 'CH', name: 'Buchs', latitude: 47.16, longitude: 9.47 }, ['CH']);
    // Unconfirmed, a hamlet's name is not enough.
    expect(place('Dintikon')).toBeNull();
  });

  it('prefers the country the parcel is in for names several countries share', () => {
    expect(place('Emmen')?.country).toBe('NL');
    expect(place('Emmen', ['CH'])?.country).toBe('CH');
    expect(place('Bienne', ['CH'])).toMatchObject({ country: 'CH' });
    expect(place('Cologne')).toMatchObject({ country: 'DE', name: 'Cologne' });
    expect(place('Genf')).toMatchObject({ country: 'CH', name: 'Genf' });
  });

  it('falls back to the country when only the country is known', () => {
    expect(place('Germany')).toMatchObject({ precision: 'country', country: 'DE', name: 'Germany' });
    expect(place('CH')).toMatchObject({ precision: 'country', country: 'CH' });
    expect(place('Example Hub, China')).toMatchObject({ precision: 'country', country: 'CN' });
  });

  it('declines text that names no place it can trust', () => {
    for (const location of [
      '', '   ', 'CENTRE DE TRI', 'Return location', 'Livré au destinataire', 'Example City', 'Home', 'Post branch',
      'Your neighbourhood', '示例市', 'FR0012', 'Maker SO 841215', 'EXAMPLE AIR HUB',
    ]) expect(place(location), location).toBeNull();
    expect(place('Warehouse 2024', ['CH'])).toBeNull();
    expect(locatePlace(undefined)).toBeNull();
  });
});

describe('placesForEvents', () => {
  it('lets a scan borrow the country of the scans around it', () => {
    const [zurich, buchs, empty] = placesForEvents(['ZUERICH, CH', 'Buchs', '  ']);
    expect(zurich?.country).toBe('CH');
    expect(buchs).toMatchObject({ country: 'CH', name: 'Buchs' });
    expect(empty).toBeNull();
    expect(placesForEvents(['Kyoto', 'Emmen', 'Leipzig'])[1]?.country).toBe('NL');
    expect(placesForEvents(['Bern', 'Emmen'])[1]?.country).toBe('CH');
  });

  it('uses the destination and the carrier before guessing', () => {
    expect(placesForEvents(['Dintikon'], { carrierCountries: ['CH', 'LI'] })[0]?.name).toBe('Dintikon');
    expect(placesForEvents(['Emmen'], { destinationCountry: 'CH' })[0]?.country).toBe('CH');
    expect(placesForEvents(['Dintikon'])[0]).toBeNull();
  });
});
