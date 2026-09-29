import type { ClassifiedStatus } from '../../core/status';

export function estafetaWording(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
}

const WORDINGS = new Map<string, ClassifiedStatus>([
  ['entregado', { status: 'delivered', stage: 'delivered' }],
  ['en proceso de entrega a domicilio', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['en transito', { status: 'in_transit', stage: 'in_transit' }],
  ['recibido por estafeta', { status: 'in_transit', stage: 'accepted' }],
  ['carga demorada por bloqueo o accidente externo en via federal', { status: 'exception', stage: 'exception' }],
  ['pendiente programacion para salida a ruta (ver fecha programada de entrega )', { status: 'in_transit', stage: 'in_transit' }],
]);

export function estafetaStatus(wording: string): ClassifiedStatus | undefined {
  const normalized = estafetaWording(wording);
  if (/^.+ llegada a centro operativo plaza destino$/.test(normalized)) return { status: 'in_transit', stage: 'in_transit' };
  return WORDINGS.get(normalized);
}
