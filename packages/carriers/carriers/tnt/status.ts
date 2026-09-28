import type { ClassifiedStatus } from '../../core/status';

const STATUS: Record<string, ClassifiedStatus> = {
  "colis chez l'expéditeur": { status: 'pending', stage: 'registered' },
  'en attente': { status: 'pending', stage: 'registered' },
  'ramassage du colis': { status: 'in_transit', stage: 'accepted' },
  'acheminement': { status: 'in_transit', stage: 'in_transit' },
  "en cours d'acheminement": { status: 'in_transit', stage: 'in_transit' },
  'livraison en cours': { status: 'out_for_delivery', stage: 'out_for_delivery' },
  'livré': { status: 'delivered', stage: 'delivered' },
  'incident de livraison': { status: 'exception', stage: 'exception' },
  "en attente d'instructions": { status: 'exception', stage: 'exception' },
};

export function tntFranceStatus(text: string): ClassifiedStatus | undefined {
  return STATUS[text.toLocaleLowerCase('fr-FR').replaceAll('’', "'")];
}
