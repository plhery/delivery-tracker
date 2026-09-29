import type { ClassifiedStatus } from '../../core/status';

function comparable(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Only actual scan wording establishes progress; the portal also sends future rail markers. */
export function classifyCorreosChileScan(code: string, wording: string): ClassifiedStatus | null {
  const label = comparable(wording);
  if (code === '003' && label === 'ENVIO EN PROCESO DE INTERNACION AL PAIS') {
    return { status: 'in_transit', stage: 'customs' };
  }
  if (code === '005' && label === 'ENVIO EN REPARTO') {
    return { status: 'out_for_delivery', stage: 'out_for_delivery' };
  }
  if ((code === '006' || code === '010') && label === 'ENVIO ENTREGADO') {
    return { status: 'delivered', stage: 'delivered' };
  }
  return null;
}
