import type { ClassifiedStatus } from '../../core/status';

const observed: Record<string, { group: string; wording: string; mapped: ClassifiedStatus }> = {
  LL020: { group: 'ENTREGADO', wording: 'EL ENVÍO HA SIDO ENTREGADO A UN VECINO.', mapped: { status: 'delivered', stage: 'delivered' } },
  LC003: { group: 'EN REPARTO', wording: 'EL ENVÍO ESTÁ EN REPARTO.', mapped: { status: 'out_for_delivery', stage: 'out_for_delivery' } },
  LI300: { group: 'EN DEMORA', wording: 'EL ENVÍO HA SUFRIDO UN RETRASO Y ES POSIBLE QUE SE DEMORE LA ENTREGA. DISCULPA LAS MOLESTIAS.', mapped: { status: 'exception', stage: 'exception' } },
  LI567: { group: 'EN TRÁNSITO', wording: 'EL ENVÍO ESTÁ EN TRÁNSITO. PRÓXIMAMENTE LLEGARÁ A LAS INSTALACIONES DE DESTINO.', mapped: { status: 'in_transit', stage: 'in_transit' } },
  SX001: { group: 'EN TRÁNSITO', wording: 'EL ENVÍO HA SIDO RECEPCIONADO EN LAS INSTALACIONES DE ORIGEN DE SEUR. COMIENZA EL TRÁNSITO A DESTINO', mapped: { status: 'in_transit', stage: 'accepted' } },
  SX010: { group: 'NOTIFICADO', wording: 'EL ENVÍO HA SIDO REGISTRADO.', mapped: { status: 'pending', stage: 'registered' } },
};

export function classifySeurStatus(code: string, group: string, wording: string): ClassifiedStatus | undefined {
  if (!Object.hasOwn(observed, code)) return undefined;
  const entry = observed[code]!;
  return group.toUpperCase() === entry.group && wording.toUpperCase() === entry.wording ? entry.mapped : undefined;
}
