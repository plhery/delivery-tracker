import type { ClassifiedStatus } from '../../core/status';

const labels: Record<string, ClassifiedStatus> = {
  INFORMADO: { status: 'pending', stage: 'registered' },
  ADMITIDO: { status: 'in_transit', stage: 'accepted' },
  'ADMITIDO EN OFICINA DE CORREOS': { status: 'in_transit', stage: 'accepted' },
  'EN RUTA A LOCALIDAD DE DESTINO': { status: 'in_transit', stage: 'in_transit' },
  'EN DESTINO': { status: 'in_transit', stage: 'in_transit' },
  'EN REPARTO': { status: 'out_for_delivery', stage: 'out_for_delivery' },
  // The fixed opening the parser keeps from an unlabelled failed round.
  'SU ENVIO NO HA PODIDO SER ENTREGADO': { status: 'exception', stage: 'failed_attempt' },
  // At the chosen pickup point, but the carrier says the collection
  // instructions are still to come; the next scan makes it available.
  'ENTREGADO EN PUNTO DE CONVENIENCIA': { status: 'in_transit', stage: 'in_transit' },
  'DISPONIBLE EN PUNTO DE CONVENIENCIA': { status: 'in_transit', stage: 'ready_for_pickup' },
  ENTREGADO: { status: 'delivered', stage: 'delivered' },
  DEVUELTO: { status: 'exception', stage: 'returned' },
  'EN ALMACEN': { status: 'exception', stage: 'exception' },
  ESTACIONADO: { status: 'exception', stage: 'exception' },
  // The accompanying carrier wording describes a rescheduled delivery after
  // an unsuccessful attempt, with the new delivery still in the future.
  'NUEVO REPARTO': { status: 'in_transit', stage: 'in_transit' },
};

export function classifyCorreosExpressStatus(label: string): ClassifiedStatus | undefined {
  const key = label.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().trim();
  return Object.hasOwn(labels, key) ? labels[key] : undefined;
}
