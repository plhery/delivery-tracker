import 'server-only';
import { inferStage, type CarrierResult } from 'universal-parcel-scraper';
import { carrierIdFromName, latestResultTime } from 'universal-parcel-scraper/app';
import type { ApiCarrierId } from '../generated/apiContract';
import { AUTOMATIC_CARRIER_IDS, requiredRequirements } from './carriers';

/** Identify an unselected parcel from one named carrier and dated shipment movement. */
export function providerCarrier(result: CarrierResult, number: string): ApiCarrierId | undefined {
  if (result.tracking_provider === 'UPU' || !Array.isArray(result.reported_carriers)
    || result.reported_carriers.length !== 1 || typeof result.reported_carriers[0] !== 'string') return undefined;
  const carrier = carrierIdFromName(result.reported_carriers[0]);
  if (!carrier || carrier !== result.discovered_carrier || !AUTOMATIC_CARRIER_IDS.has(carrier)
    || requiredRequirements(carrier, number).length) return undefined;
  const datedProgress = result.events?.some((event) => {
    const stage = event.stage ?? inferStage(event.description ?? '', 'pending');
    const instant = latestResultTime({ events: [event] }, 'unknown');
    return !['pending', 'registered', 'unknown'].includes(stage)
      && typeof event.time === 'string' && /(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/i.test(event.time)
      && instant > 0 && instant <= Date.now() + 3_600_000;
  });
  return datedProgress ? carrier as ApiCarrierId : undefined;
}
