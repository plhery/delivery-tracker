/**
 * Correos (Spain) status vocabulary.
 *
 * `codEvento` is the stable key of a localizador event; the Spanish
 * `desTextoResumen` next to it is display prose and is never mapped. The
 * vocabulary is explicitly still being observed, so an unmapped code yields no
 * stage at all: the event keeps its raw wording, the result reports `unknown`,
 * and the sync classifies and records it.
 *
 * Provenance: derived from the prior-art client
 * https://github.com/ha-parcel-integrations/ha-correos (MIT) and confirmed
 * against a real ES parcel on 2026-08-24 (admitted → classified →
 * out for delivery → failed attempt → office hold → collected).
 */
import type { ClassifiedStatus } from '../../core/status';

const EVENT_STATUS: Record<string, ClassifiedStatus> = {
  'A010000V': { status: 'pending', stage: 'registered' },
  'A090000V': { status: 'pending', stage: 'registered' },
  'X010000V': { status: 'pending', stage: 'registered' },
  'P040000V': { status: 'in_transit', stage: 'in_transit' },
  'P100000V': { status: 'in_transit', stage: 'in_transit' },
  'P110000V': { status: 'in_transit', stage: 'in_transit' },
  'P101110V': { status: 'in_transit', stage: 'in_transit' },
  'P101120V': { status: 'in_transit', stage: 'in_transit' },
  'P090000V': { status: 'in_transit', stage: 'in_transit' },
  'G01L010V': { status: 'in_transit', stage: 'in_transit' },
  'H01I360V': { status: 'in_transit', stage: 'in_transit' },
  'X020000V': { status: 'in_transit', stage: 'in_transit' },
  'X040000V': { status: 'in_transit', stage: 'in_transit' },
  'X060000V': { status: 'in_transit', stage: 'in_transit' },
  'X070000V': { status: 'in_transit', stage: 'in_transit' },
  'X110100V': { status: 'in_transit', stage: 'in_transit' },
  'H020000V': { status: 'out_for_delivery', stage: 'out_for_delivery' },
  'X080000V': { status: 'out_for_delivery', stage: 'out_for_delivery' },
  'H01I350V': { status: 'out_for_delivery', stage: 'ready_for_pickup' },
  'X380000V': { status: 'out_for_delivery', stage: 'ready_for_pickup' },
  'X390000V': { status: 'out_for_delivery', stage: 'ready_for_pickup' },
  // Community-integration reconstructions, not yet re-observed: kept, but an
  // unmapped code elsewhere still reports unknown rather than guessing.
  'L010000V': { status: 'out_for_delivery', stage: 'ready_for_pickup' },
  'I01H210V': { status: 'delivered', stage: 'delivered' },
  'X120000V': { status: 'delivered', stage: 'delivered' },
  'I010000V': { status: 'delivered', stage: 'delivered' },
  'H010930R': { status: 'exception', stage: 'failed_attempt' },
  'H06P010V': { status: 'exception', stage: 'failed_attempt' },
  'X090100R': { status: 'exception', stage: 'failed_attempt' },
  'X090060R': { status: 'exception', stage: 'failed_attempt' },
  'X130000R': { status: 'exception', stage: 'failed_attempt' },
  'M01E020R': { status: 'exception', stage: 'failed_attempt' },
  'EOL.9001': { status: 'exception', stage: 'failed_attempt' },
  'O140000V': { status: 'exception', stage: 'returned' },
};

/** The stage and status for a Correos `codEvento`, or undefined when unmapped. */
export function classifyCorreosSpainStatus(code: string): ClassifiedStatus | undefined {
  return EVENT_STATUS[code];
}
