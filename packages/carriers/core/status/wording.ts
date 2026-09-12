/**
 * The generic wording classifier: multilingual language rules first, then the
 * broad keyword rules, each with a stable rule id. It is the fallback the sync
 * uses when a carrier has no explicit map for an event; carrier maps and
 * provider-declared stages always outrank it (ARCHITECTURE.md § Status model).
 *
 * Rule ids are persisted per event as `raw_data.stage_source` and grouped in
 * `tracking_status_observations`, so renaming one is a data change.
 */
import type { Stage } from '../../generated/catalog';
import { trackingLanguageStage } from './language';

export interface ClassifiedWording {
  stage: Stage;
  /**
   * How the stage was decided: `wording:<rule>` names the rule that matched,
   * `none` means no rule matched and the caller's fallback was used.
   */
  source: string;
}

/**
 * The wording classifier. Rule ids are stable: they are persisted per event as
 * `raw_data.stage_source` and grouped in `tracking_status_observations`.
 */
export function classifyWording(text: string, fallback: Stage = 'in_transit'): ClassifiedWording {
  const matched = (stage: Stage, rule: string): ClassifiedWording => (
    { stage, source: `wording:${rule}` }
  );
  const translated = trackingLanguageStage(text);
  if (translated) return matched(translated, 'language');
  const value = text.toLocaleLowerCase('en-US').replaceAll('_', ' ').trim().split(/\s+/).join(' ');
  if (value.includes('to be delivered')) return matched('in_transit', 'to_be_delivered');
  if (value === 'reported') return matched('registered', 'reported');
  if (['will shortly be handed over', 'shipment information received', 'electronic shipment information']
    .some((term) => value.includes(term))) return matched('registered', 'pre_advice');
  if (['return to sender', 'returned', 'retour'].some((term) => value.includes(term))) {
    return matched('returned', 'returned');
  }
  if (['not delivered', 'could not be delivered', 'unable to deliver', 'delivery attempt',
    'failed', 'unsuccessful', 'missed delivery', 'nicht zugestellt',
    'zustellung nicht möglich', 'non livré', 'livraison impossible',
    'échec de livraison', 'mancata consegna'].some((term) => value.includes(term))) {
    return matched('failed_attempt', 'failed_attempt');
  }
  // Carrier-reported problems that are not a missed attempt and not a return.
  if (['damaged', 'endommagé', 'avarie', 'avarié', 'beschädigt', 'danneggiato', 'dañado', 'danificado', 'uszkodzon']
    .some((term) => value.includes(term))) return matched('exception', 'exception_damaged');
  if (['lost in transit', 'package lost', 'parcel lost', 'colis perdu', 'envoi perdu', 'égaré',
    'verloren', 'smarrito', 'extraviado', 'zagubiona'].some((term) => value.includes(term))) {
    return matched('exception', 'exception_lost');
  }
  if (['refused', 'rejected by recipient', 'refusé par le destinataire', 'colis refusé',
    'annahme verweigert', 'rifiutato', 'rechazado', 'recusado', 'odmowa przyjęcia']
    .some((term) => value.includes(term))) return matched('exception', 'exception_refused');
  if (['incorrect address', 'incomplete address', 'insufficient address', 'address unknown',
    'addressee cannot be located', 'adresse incorrecte', 'adresse incomplète', 'adresse falsch',
    'empfänger unbekannt', 'indirizzo errato', 'dirección incorrecta', 'endereço incorreto',
    'nieprawidłowy adres'].some((term) => value.includes(term))) {
    return matched('exception', 'exception_address');
  }
  if (['held by customs', 'customs issue', 'customs problem', 'retenu en douane', 'fermo in dogana',
    'retenido en aduana', 'retido na alfândega'].some((term) => value.includes(term))) {
    return matched('exception', 'exception_customs_problem');
  }
  // "en souffrance" and "in giacenza" are deliberately absent: in postal
  // wording they usually mean a parcel waiting for collection, not a problem.
  if (['action required', 'awaiting instructions', 'shipment held', 'on hold',
    'en attente d\'instructions', 'zurückgehalten', 'retenido', 'retida']
    .some((term) => value.includes(term))) return matched('exception', 'exception_held');
  if (['incident', 'anomalie', 'anomaly', 'delivery exception', 'shipment exception', 'carrier exception',
    'incidencia', 'irregularität'].some((term) => value.includes(term))) {
    return matched('exception', 'exception_incident');
  }
  if (['ready for pickup', 'ready for collection', 'abholbereit', 'deposited in the mypost24 machine']
    .some((term) => value.includes(term))) return matched('ready_for_pickup', 'ready_for_pickup');
  if (['delivered', 'deposited', 'zugestellt', 'confirmation of receipt']
    .some((term) => value.includes(term))) return matched('delivered', 'delivered');
  if (['out for delivery', 'in delivery', 'loading into delivery vehicle',
    'loaded into delivery vehicle', 'zustellung'].some((term) => value.includes(term))) {
    return matched('out_for_delivery', 'out_for_delivery');
  }
  if (['was released by customs', 'has been released by customs', 'has been released by a government agency']
    .some((term) => value.includes(term))) return matched('in_transit', 'customs_released');
  if (['customs', 'custom clearance', 'zoll', 'pending release from a government agency']
    .some((term) => value.includes(term))) return matched('customs', 'customs');
  if (['accepted', 'received at', 'handed over', 'handed to dpd', 'parcel handed', 'posted']
    .some((term) => value.includes(term))) return matched('accepted', 'accepted');
  if (['announced', 'registered', 'label created', 'created a label', 'information received', 'elektronisch angekündigt']
    .some((term) => value.includes(term))) return matched('registered', 'registered');
  if (['transit', 'sorted', 'sorting', 'departed', 'arrived', 'transport', 'delivery centre', 'depot',
    'on the way', 'import scan', 'delivery will be delayed']
    .some((term) => value.includes(term))) return matched('in_transit', 'in_transit');
  return { stage: fallback, source: 'none' };
}

/** The stage alone, for callers that do not record provenance. */
export function wordingStage(text: string, fallback: Stage = 'in_transit'): Stage {
  return classifyWording(text, fallback).stage;
}
