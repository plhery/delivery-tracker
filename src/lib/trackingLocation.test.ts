import { describe, expect, it } from 'vitest';
import { trackingLocationLabel } from './trackingLocation';

describe('tracking location flags', () => {
  it.each([
    ['France', '🇫🇷'], ['Germany', '🇩🇪'], ['Switzerland', '🇨🇭'],
    ['Zürich, Schweiz', 'Zürich, 🇨🇭'], ['Bâle (Suisse)', 'Bâle (🇨🇭)'],
    ['Milano, Italia', 'Milano, 🇮🇹'], ['Paris; France', 'Paris; 🇫🇷'],
    ['DE', '🇩🇪'], ['London, UK', 'London, 🇬🇧'], ['CH ', '🇨🇭 '],
  ])('replaces explicit countries in %s and preserves the location', (location, expected) => {
    expect(trackingLocationLabel(location)).toBe(expected);
  });

  it.each(['', 'Warehouse', 'Paris', 'Buchs AG', 'Basel, BS', 'Wilmington, DE', 'France distribution center'])('leaves unknown or ambiguous locations intact: %s', (location) => {
    expect(trackingLocationLabel(location)).toBe(location);
  });
});
