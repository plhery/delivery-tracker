import type { ClassifiedStatus } from '../../core/status';

const labels: Record<string, ClassifiedStatus> = {
  ACEPTADA: { status: 'in_transit', stage: 'accepted' },
  'EN TRANSITO': { status: 'in_transit', stage: 'in_transit' },
  'EN REPARTO': { status: 'out_for_delivery', stage: 'out_for_delivery' },
  'DISPONIBLE EN PUNTO NACEX': { status: 'in_transit', stage: 'ready_for_pickup' },
  AUSENTE: { status: 'exception', stage: 'failed_attempt' },
  ENTREGADO: { status: 'delivered', stage: 'delivered' },
};

export function classifyNacexStatus(label: string): ClassifiedStatus | undefined {
  const key = label.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().trim();
  return Object.hasOwn(labels, key) ? labels[key] : undefined;
}
