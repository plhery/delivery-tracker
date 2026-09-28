import { timeZoneCountry } from '@carriers/core/time';
import { describe, expect, it } from 'vitest';
import demo from '../../../shared/delivery-demo.json';
import { SIMULATED_UPDATES } from '../../store/demoRepo';
import { carrierTimezone } from '../carriers';
import { locatePlace, placesForEvents } from './index';

interface DemoEvent { location?: string; place?: unknown }

// The web demo has no server, so its sample scans carry the places the server would give them.
describe('demo places', () => {
  it('match what the server locates for each sample scan', () => {
    for (const sample of demo as { carrier: string; events: DemoEvent[] }[]) {
      const country = timeZoneCountry(carrierTimezone(sample.carrier));
      const places = placesForEvents(sample.events.map((event) => event.location), { carrierCountries: country ? [country] : [] });
      sample.events.forEach((event, index) => expect(event.place ?? null, `${sample.carrier}: ${event.location}`).toEqual(places[index]));
    }
    for (const update of Object.values(SIMULATED_UPDATES)) {
      if (update.location) expect(update.place ?? null, update.location).toEqual(locatePlace(update.location, { countries: ['CH'] }));
    }
  });
});
