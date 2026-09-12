/**
 * Hermes Einrichtungs-Service status classification.
 *
 * The myhes.de order API returns a numeric `sendungsstatusId` per timeline row
 * plus the German wording shown to the customer. The numeric map below is the
 * authority; wording is only consulted for ids the map does not know, so a new
 * id degrades to a sensible stage instead of an invented one.
 */
import type { CarrierStatus } from '../../core/result';
import type { Stage } from '../../generated/catalog';

/** Observed `sendungsstatusId` values and the status each one means. */
export const HERMES_STATUS = new Map<number, CarrierStatus>([
  [40, 'pending'],
  [100, 'in_transit'],
  [190, 'in_transit'],
  [300, 'in_transit'],
  [307, 'in_transit'],
  [318, 'exception'],
  [319, 'exception'],
  [320, 'exception'],
  [321, 'exception'],
  [314, 'in_transit'],
  [315, 'in_transit'],
  [500, 'in_transit'],
  [701, 'delivered'],
  [702, 'delivered'],
  [700, 'delivered'],
  [720, 'delivered'],
  [721, 'delivered'],
  [722, 'delivered'],
  [728, 'delivered'],
  [731, 'delivered'],
  [740, 'delivered'],
  [742, 'delivered'],
  [430, 'out_for_delivery'],
]);

function normalizedText(raw: unknown): string {
  return String(raw ?? '').toLocaleLowerCase('de-DE').normalize('NFKD').replace(/\p{M}/gu, '');
}

export function hermesStatus(rawStatusId: unknown, rawDescription: unknown = ''): CarrierStatus {
  if (!['string', 'number'].includes(typeof rawStatusId)) return 'pending';
  const statusId = Number(rawStatusId);
  if (!Number.isFinite(statusId)) return 'pending';
  const known = HERMES_STATUS.get(statusId);
  if (known) return known;
  const description = normalizedText(rawDescription);
  if (/(nicht zugestellt|fehlgeschlagen|storniert|retour|zuruck)/.test(description)) {
    return 'exception';
  }
  if (/(erfolgreich zugestellt|ware geliefert|wurde .* zugestellt|delivered)/.test(description)) {
    return 'delivered';
  }
  if (/(befindet sich auf tour|fahrzeugbeladung|ankunft bei kundenadresse|out for delivery)/
    .test(description)) return 'out_for_delivery';
  if (description) return statusId === 40 ? 'pending' : 'in_transit';
  return 'pending';
}

/** The event-level stage that follows from the row's status. */
export function hermesEventStage(rawStatusId: unknown, rawDescription: unknown): Stage {
  const status = hermesStatus(rawStatusId, rawDescription);
  if (status === 'exception') return 'failed_attempt';
  if (status === 'pending') return 'registered';
  return status as Stage;
}
