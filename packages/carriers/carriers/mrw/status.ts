import type { ClassifiedStatus } from '../../core/status';

const LABELS: Record<string, ClassifiedStatus> = {
  'PENDIENTE DE RECOGER': { status: 'pending', stage: 'registered' },
  'ENVIO RECOGIDO EN ORIGEN': { status: 'in_transit', stage: 'accepted' },
  'EN TRANSITO': { status: 'in_transit', stage: 'in_transit' },
  'ENVIO EN REPARTO': { status: 'out_for_delivery', stage: 'out_for_delivery' },
  'DESTINATARIO AUSENTE O CERRADO': { status: 'exception', stage: 'failed_attempt' },
  'DEPOSITADO EN PUNTO MRW': { status: 'in_transit', stage: 'ready_for_pickup' },
  'DEPOSITADO EN POINTCORNER DESTINO': { status: 'in_transit', stage: 'ready_for_pickup' },
  'ENVIO ENTREGADO': { status: 'delivered', stage: 'delivered' },
};

export function classifyMrwStatus(value: string): ClassifiedStatus | undefined {
  const key = value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();
  return Object.hasOwn(LABELS, key) ? LABELS[key] : undefined;
}
