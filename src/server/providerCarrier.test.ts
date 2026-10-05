import { expect, it } from 'vitest';
import type { CarrierResult } from 'universal-parcel-scraper';
import { providerCarrier } from './providerCarrier';

const history: CarrierResult = { tracking_provider: 'Ship24', discovered_carrier: 'dhl-express',
  reported_carriers: ['DHL Express'], events: [{ time: '2026-09-10T11:00:00Z', stage: 'delivered', description: 'Delivered' }] };

it('uses a single named carrier with dated movement', () => {
  expect(providerCarrier(history, '1234567891')).toBe('dhl-express');
});

it.each<Partial<CarrierResult>>([
  { reported_carriers: ['DHL'] },
  { reported_carriers: ['DHL Express', 'Swiss Post'] },
  { reported_carriers: ['Unknown Carrier'] },
  { discovered_carrier: 'dhl' },
  { reported_carriers: undefined },
  { tracking_provider: 'UPU' },
  { events: [] },
  { events: [{ stage: 'registered', time: '2026-09-10T11:00:00Z', description: 'Label created' }] },
  { events: [{ stage: 'delivered', time: '2026-09-10T11:00:00', description: 'Delivered' }] },
  { events: [{ stage: 'delivered', time: '9999-09-10T11:00:00Z', description: 'Delivered' }] },
])('keeps ambiguous names and undated or registration-only answers unresolved: %j', (change) => {
  expect(providerCarrier({ ...history, ...change }, '1234567891')).toBeUndefined();
});

it('keeps a carrier requiring recipient input unresolved', () => {
  expect(providerCarrier({ ...history, discovered_carrier: 'gls-ch', reported_carriers: ['GLS Switzerland'] }, '12345678')).toBeUndefined();
});
