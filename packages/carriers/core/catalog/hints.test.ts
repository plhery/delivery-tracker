import { describe, expect, it } from 'vitest';
import {
  carrierIdFromName, carrierIdFromPartner, carrierIdFromPartnerLinks, isKnownCarrierName, nationalPostCandidate,
} from './hints';

describe('national postal lookup candidates', () => {
  it.each([
    ['CH', 'swiss-post'], [' Switzerland ', 'swiss-post'], ['FI', 'posti'], ['finland', 'posti'],
    ['NL', 'spring-gds'], ['FR', 'la-poste'], ['GB', 'royal-mail'], ['US', 'usps'],
    ['CA', 'canada-post'], ['DE', 'dhl'], ['ES', 'correos-spain'], ['IN', 'india-post'],
    ['IT', 'poste-italiane'], ['JP', 'japan-post'], ['Japan', 'japan-post'], ['MY', 'pos-malaysia'], ['PT', 'ctt'],
  ])('suggests one operator for destination %s', (country, expected) => {
    expect(nationalPostCandidate(country)).toBe(expected);
  });
  it.each(['XX', 'LI', 'unknown', 'Arrived in Switzerland', 'constructor', '', null, 123])(
    'leaves unavailable or ambiguous destinations alone: %s', (country) => {
      expect(nationalPostCandidate(country)).toBeUndefined();
    },
  );
});

describe('delivery partner evidence', () => {
  it.each([
    ['Posti', '', 'posti'],
    ['Unknown partner label', 'https://www.posti.fi/en/tracking#/lahetys/TEST1234?lang=en', 'posti'],
    ['Swiss Post', 'https://www.post.ch/', 'swiss-post'],
    ['USPS', 'https://tools.usps.com/go/TrackConfirmAction', 'usps'],
    ['Asendia USA', '', 'asendia'],
    ['Asendia', 'https://a1.asendiausa.com/tracking/?trackingnumber=TEST1234', 'asendia'],
    ['GLS', '', undefined],
    ['constructor', '', undefined],
    ['Unknown carrier', '', undefined],
    ['Posti', 'https://www.post.ch/', undefined],
    ['', 'https://www.posti.fi.evil.test/', undefined],
    ['', 'https://www.posti.fi@evil.test/', undefined],
    ['', 'https://evil.test/?url=https://www.posti.fi/', undefined],
    ['', 'javascript://www.posti.fi/', undefined],
    ['', 'not a URL', undefined],
  ])('resolves name %s and URL %s without guessing', (name, url, expected) => {
    expect(carrierIdFromPartner(name, url)).toBe(expected);
  });

  it('does not pick one of multiple partner links, but ignores the origin’s own links', () => {
    const origin = 'See https://www.dhl.de/ for tracking.';
    expect(carrierIdFromPartnerLinks([origin, 'Partner: https://www.posti.fi/en/tracking'], 'dhl')).toBe('posti');
    expect(carrierIdFromPartnerLinks(['https://www.posti.fi/ https://www.post.ch/'], 'dhl')).toBeUndefined();
  });
});

describe('carrier names reported by universal providers', () => {
  it.each([
    ['UPS', 'ups'], ['La Poste (Colissimo)', 'la-poste'], ['Chronopost France', 'chronopost'],
    ['Chronopost (France)', 'chronopost'], ['Posti Finland', 'posti'], ['Swiss Post CH', 'swiss-post'],
  ])('maps %s, a carrier followed by its own country included', (name, expected) => {
    expect(carrierIdFromName(name)).toBe(expected);
  });

  it.each([
    // Another company under the brand, a country without one zone, a brand with several networks.
    'Chronopost Portugal', 'Correos Chile', 'UPS United States', 'DHL Germany', 'GLS', 'France',
  ])('does not guess a carrier from %s', (name) => {
    expect(carrierIdFromName(name)).toBeUndefined();
  });

  it.each([
    'La Poste', 'La Poste (Colissimo)', 'Chronopost France', 'FedEx', 'India Post', 'Posti', 'UPS',
    'Chronopost Portugal', 'Correos Chile', 'Royal Mail (UK)', 'DHL', 'DHL Express', 'GLS Italy', 'DPD UK',
  ])('knows %s from the catalog', (name) => {
    expect(isKnownCarrierName(name)).toBe(true);
  });

  it.each(['Example Parcel Co', 'Example Express Italy', 'Postexample Courier'])('treats %s as new', (name) => {
    expect(isKnownCarrierName(name)).toBe(false);
  });
});
