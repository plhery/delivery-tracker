import { carrierRequirements, formatTrackingNumber, normalizeTrackingNumber, type CarrierInputField } from '../lib/carriers';
import type { CarrierAnswer } from '../peek/linkModel';
import { initialLookup, survey, type DeviceParcel } from '../peek/lookup/machine';
import type { CarrierId, NewParcelInput } from '../types';

/** What the deliveries' field does with a text once it is asked to go on. */
export type FieldAction =
  /** Something is left for the person to settle: the Add sheet takes the text. */
  | { type: 'sheet' }
  /** The number is in the deliveries already. */
  | { type: 'open'; id: string }
  /** The number's shape fits several carriers: they are asked before anything is added. */
  | { type: 'ask'; number: string; shown: string; carriers: readonly CarrierId[] }
  /** One carrier and nothing missing: the parcel is added at once. */
  | { type: 'add'; shown: string; input: NewParcelInput };

/** The deliveries as the front door's reading knows parcels: by their number. */
export function followedParcels(parcels: readonly { id: string; trackingNumber: string; carrier: CarrierId }[]): DeviceParcel[] {
  return parcels.map(({ id, trackingNumber, carrier }) => ({ id, number: normalizeTrackingNumber(trackingNumber), carrier }));
}

/**
 * Reads the field the way the front door does and decides what follows. A
 * parcel is added at once only when nothing is left to choose: one number,
 * one carrier that is certain, and no input that carrier requires. Several
 * numbers, several carriers, an Amazon number, a check digit that does not
 * add up, a required postcode or link, and a text without a number all go to
 * the Add sheet. `answer` is what the carriers said when they were asked.
 */
export function fieldAction(text: string, followed: readonly DeviceParcel[], answer: CarrierAnswer | null = null): FieldAction {
  if (!text.trim()) return { type: 'sheet' };
  const read = { ...initialLookup(text), raised: true };
  const number = survey(read, followed).normalized;
  const found = survey({ ...read, asked: number || null, answer }, followed);
  const { match } = found;
  if (!match || found.several.length > 0 || found.typo || found.amazon) return { type: 'sheet' };
  if (found.onDevice) return { type: 'open', id: found.onDevice.id };
  if (found.need === 'wait') {
    return {
      type: 'ask',
      number: found.normalized,
      shown: formatTrackingNumber(match.trackingNumber, found.carrier),
      carriers: found.check.status === 'asking' ? found.check.asked : [],
    };
  }
  if (!found.certain || found.need) return { type: 'sheet' };
  const wants = (field: CarrierInputField) =>
    carrierRequirements(found.carrier, match.trackingNumber).some((requirement) => requirement.field === field);
  return {
    type: 'add',
    shown: formatTrackingNumber(match.trackingNumber, found.carrier),
    input: {
      trackingNumber: match.trackingNumber.trim(),
      label: '',
      carrier: found.carrier,
      // A link the carrier requires came with the paste; an optional postcode can follow later.
      ...(wants('trackingUrl') ? { trackingUrl: found.input('trackingUrl').trim() } : {}),
    },
  };
}
