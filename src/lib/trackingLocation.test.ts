import { describe, expect, it } from 'vitest';
import { countryFlag, countryName, trackingLocationCountry, trackingPlace } from './trackingLocation';

describe('tracking places', () => {
  it.each([
    ['Zürich, Schweiz', 'CH', 'Zürich'], ['Bâle (Suisse)', 'CH', 'Bâle'], ['Milano, Italia', 'IT', 'Milano'],
    ['Paris; France', 'FR', 'Paris'], ['London, UK', 'GB', 'London'], ['ZUERICH, CH', 'CH', 'ZUERICH'],
    ['Zürich (Mülligen), CH', 'CH', 'Zürich (Mülligen)'], ['Hebron, KY, US, US', 'US', 'Hebron, KY'],
    ['Switzerland Haerkingen', 'CH', 'Haerkingen'], ['United Kingdom Coventry', 'GB', 'Coventry'],
  ])('takes the country off %s', (location, country, place) => {
    expect(trackingPlace(location)).toEqual({ country, place });
  });

  it.each([
    ['France', 'FR'], ['DE', 'DE'], ['CH ', 'CH'], ['THE NETHERLANDS', 'NL'], ['Czech Republic', 'CZ'], ['Hong Kong', 'HK'],
  ])('leaves no place when %s is only a country', (location, country) => {
    expect(trackingPlace(location)).toEqual({ country, place: '' });
  });

  it.each([
    '', 'Warehouse', 'Paris', 'Buchs AG', 'Basel, BS', 'Wilmington, DE', 'France distribution center',
    'Zürich Briefzentrum', 'Mexico City', 'Andorra la Vella',
  ])('keeps %s whole without guessing a country', (location) => {
    expect(trackingPlace(location)).toEqual({ country: null, place: location });
  });

  it('keeps Passport evidence to a final field that names a region', () => {
    expect(trackingLocationCountry('Zürich, CH')).toBe('CH');
    expect(trackingLocationCountry('Switzerland Haerkingen')).toBeNull();
    expect(trackingLocationCountry('Czech Republic')).toBeNull();
  });

  it('names the country in the reader’s language', () => {
    expect(countryFlag('CH')).toBe('🇨🇭');
    expect(countryName('CZ', 'de')).toBe('Tschechien');
    expect(countryName('FI', 'fr')).toBe('Finlande');
    expect(countryName('HK', 'en')).toBe('Hong Kong');
  });
});
