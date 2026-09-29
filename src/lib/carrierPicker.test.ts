import { describe, expect, it } from 'vitest';
import { carrierInfo, recognitionAskedCarriers, SELECTABLE_CARRIERS } from './carriers';
import {
  alphabetSections,
  carrierCheck,
  countryLine,
  foldForSearch,
  searchCarriers,
  usedCarrierIds,
} from './carrierPicker';
import { countryName } from './trackingLocation';
import type { CarrierId } from '../types';

const countryNames = (code: string) => [countryName(code, 'en-CH')];
const search = (query: string, preferred: CarrierId[] = []) =>
  searchCarriers(query, SELECTABLE_CARRIERS, { languageTag: 'en-CH', countryNames, preferred: new Set(preferred) });
const names = (query: string, preferred?: CarrierId[]) => search(query, preferred).map((result) => result.carrier.name);

describe('carrier search', () => {
  it('finds a name by its start, then by a later word', () => {
    expect(names('dpd').slice(0, 2)).toEqual(['DPD', 'DPD France']);
    expect(names('post').slice(0, 3)).toEqual(['Poste Italiane', 'Posti', 'PostLogistics']);
    expect(names('post')).toContain('Swiss Post');
  });

  it('ignores case, accents and punctuation', () => {
    expect(foldForSearch('Colis Privé')).toBe('colis prive');
    expect(names('colis prive')[0]).toBe('Colis Privé');
    expect(names('jt')[0]).toBe('J&T Express');
    expect(names('4px')[0]).toBe('4PX');
  });

  it('finds a carrier by another name, and says which', () => {
    const [hugger] = search('hugger');
    expect(hugger.carrier.id).toBe('swiss-post-cargo');
    expect(hugger.alias).toBe('Hugger');
    expect(hugger.highlight).toBeUndefined();
    expect(names('die post')[0]).toBe('Swiss Post');
    expect(names('cainiao')[0]).toBe('AliExpress / Cainiao');
    expect(names('hermes uk')[0]).toBe('Evri');
  });

  it('marks the matched part of the name', () => {
    const colis = search('colis');
    expect(colis.map((result) => result.carrier.name)).toEqual(['Colis Privé', 'Colisweb', 'La Poste / Colissimo', 'Relais Colis']);
    expect(colis[2].highlight).toEqual([11, 16]);
  });

  it('finds carriers by the countries they deliver in, after any name', () => {
    const italy = names('italy');
    expect(italy).toEqual(expect.arrayContaining(['BRT', 'Poste Italiane', 'InPost']));
    expect(names('portugal')).toEqual(expect.arrayContaining(['CTT Portugal', 'MRW', 'SEUR']));
  });

  it('ranks the carriers that fit the number a little higher', () => {
    expect(names('gls')[0]).toBe('GLS France');
    expect(names('gls', ['gls-ch'])[0]).toBe('GLS Switzerland');
  });

  it('finds nothing for text no carrier has', () => {
    expect(search('zzqx')).toEqual([]);
    expect(search('   ')).toEqual([]);
  });
});

describe('carrier sections', () => {
  it('groups every selectable carrier by initial, digits last', () => {
    const sections = alphabetSections(SELECTABLE_CARRIERS, 'en-CH');
    expect(sections.flatMap((section) => section.carriers)).toHaveLength(SELECTABLE_CARRIERS.length);
    expect(sections[0].letter).toBe('A');
    expect(sections.at(-1)).toEqual({ letter: '#', carriers: [carrierInfo('four-px')] });
    expect(sections.find((section) => section.letter === 'C')?.carriers.map((carrier) => carrier.name))
      .toContain('Colis Privé');
  });

  it('shows up to two countries, and none for a network across many', () => {
    const name = (code: string) => countryName(code, 'en-CH');
    expect(countryLine(['CH', 'LI'], name)).toBe('Switzerland · Liechtenstein');
    expect(countryLine(['FR', 'BE', 'ES', 'LU', 'PT'], name)).toBe('France · Belgium +3');
    expect(countryLine(carrierInfo('amazon-logistics').countries, name)).toBe('');
    expect(countryLine([], name)).toBe('');
  });

  it('lists the carriers of the latest parcels once each', () => {
    const parcels = [
      { carrier: 'dpd', createdAt: '2026-09-01T00:00:00Z' },
      { carrier: 'swiss-post', createdAt: '2026-09-03T00:00:00Z' },
      { carrier: 'unknown', createdAt: '2026-09-04T00:00:00Z' },
      { carrier: 'dpd', createdAt: '2026-09-02T00:00:00Z' },
      { carrier: 'planzer', createdAt: '2026-08-01T00:00:00Z' },
      { carrier: 'ups', createdAt: '2026-07-01T00:00:00Z' },
    ] as const;
    const selectable = (carrier: CarrierId) => carrierInfo(carrier).capabilities.selectable;
    expect(usedCarrierIds(parcels, selectable)).toEqual(['swiss-post', 'dpd', 'planzer']);
  });
});

describe('carrier check', () => {
  const number = '06080000000002';
  const asked = recognitionAskedCarriers(number) as CarrierId[];

  it('asks the carriers the detect route asks', () => {
    expect(asked).toEqual(['dpd', 'ciblex']);
  });

  it('follows the number from settled to answered', () => {
    expect(carrierCheck({ applies: true, settled: false, asked })).toEqual({ status: 'idle' });
    expect(carrierCheck({ applies: false, settled: true, asked })).toEqual({ status: 'idle' });
    expect(carrierCheck({ applies: true, settled: true, asked })).toEqual({ status: 'asking', asked });
    expect(carrierCheck({ applies: true, settled: true, asked: [] })).toEqual({ status: 'unasked' });
  });

  it('reads the answer', () => {
    const answered = (answer: object) => carrierCheck({
      applies: true, settled: true, asked, answer: { trackingNumber: number, carrier: 'unknown', ...answer },
    });
    expect(answered({ carrier: 'dpd', asked })).toEqual({ status: 'found', carrier: 'dpd' });
    expect(answered({ recognized: ['dpd', 'ciblex'], asked })).toEqual({ status: 'several', carriers: ['dpd', 'ciblex'] });
    expect(answered({ asked })).toEqual({ status: 'none', asked });
    // One carrier failing is not "could not check"; every one failing is.
    expect(answered({ asked, unanswered: ['dpd'] })).toEqual({ status: 'none', asked });
    expect(answered({ asked, unanswered: asked })).toEqual({ status: 'failed', asked });
    // A server that asked nobody leaves the number to routing.
    expect(answered({})).toEqual({ status: 'unasked' });
  });
});
