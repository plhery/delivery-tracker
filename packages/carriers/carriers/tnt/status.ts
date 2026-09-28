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

// tnt.com scan codes (`legacyCode`). The wording is prose and changes with the
// locale; "partially delivered" must not read as a delivery.
const EXPRESS_CODES: Record<string, ClassifiedStatus> = {
  PU: { status: 'in_transit', stage: 'accepted' },
  CI: { status: 'in_transit', stage: 'in_transit' },
  TR: { status: 'in_transit', stage: 'in_transit' },
  OS: { status: 'in_transit', stage: 'in_transit' },
  IS: { status: 'in_transit', stage: 'in_transit' },
  HW: { status: 'in_transit', stage: 'in_transit' },
  AS: { status: 'in_transit', stage: 'in_transit' },
  IR: { status: 'in_transit', stage: 'in_transit' },
  OD: { status: 'out_for_delivery', stage: 'out_for_delivery' },
  OK: { status: 'delivered', stage: 'delivered' },
  LP: { status: 'exception', stage: 'exception' },
  MR: { status: 'exception', stage: 'exception' },
  WL: { status: 'exception', stage: 'exception' },
  RTS: { status: 'exception', stage: 'returned' },
};

export function tntExpressStatus(code: string): ClassifiedStatus | undefined {
  return Object.hasOwn(EXPRESS_CODES, code) ? EXPRESS_CODES[code] : undefined;
}
