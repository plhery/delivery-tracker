import type { CarrierResult } from 'universal-parcel-scraper';
import persistence from '../server/fixtures/persistenceResults.json';

/** Synthetic scraper responses replayed at the application's persistence boundary. */
export function carrierResult(name: keyof typeof persistence): CarrierResult {
  return structuredClone(persistence[name]) as CarrierResult;
}
