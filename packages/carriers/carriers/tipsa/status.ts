import { languageStageStatus, trackingLanguageStage, type ClassifiedStatus } from '../../core/status';

function comparable(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// TIPSA's history labels, as the shipment page lists them.
const LABELS = new Map<string, ClassifiedStatus>([
  ['PENDIENTE DE ENTREGAR A TIPSA', { status: 'pending', stage: 'registered' }],
  ['TRANSITO', { status: 'in_transit', stage: 'in_transit' }],
  ['LEIDO EN DESTINO', { status: 'in_transit', stage: 'in_transit' }],
  ['REPARTO', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['AUSENTE', { status: 'exception', stage: 'failed_attempt' }],
  ['ENTREGADO', { status: 'delivered', stage: 'delivered' }],
]);

/** A label's stage: TIPSA's own vocabulary first, then the shared Spanish and Portuguese wording rules. */
export function tipsaStatus(label: string): ClassifiedStatus | undefined {
  const key = comparable(label);
  // The destination agency's name follows ("LECTURA EN AGENCIA DESTINO EJEMPLO 01").
  if (/^LECTURA EN AGENCIA DESTINO\b/.test(key)) return { status: 'in_transit', stage: 'in_transit' };
  const known = LABELS.get(key);
  if (known) return known;
  const worded = trackingLanguageStage(label);
  return worded ? { status: languageStageStatus(worded), stage: worded } : undefined;
}
