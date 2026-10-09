import type { LookupState, Survey } from './machine';

/**
 * What stops the door from opening a parcel, as usage counts name it: one
 * fixed action per notice or question the visitor is shown. Never the text,
 * the number or the carrier.
 */
export const DOOR_STOPS = {
  /** The text holds no tracking number. */
  nothing: 'door-no-number',
  /** The text is an Amazon order number. */
  order: 'door-order-number',
  /** A postal number whose check digit does not add up. */
  typo: 'door-check-digit',
  /** The text names several numbers: one is to be chosen. */
  numbers: 'door-several-numbers',
  /** Several carriers know the number: one is to be chosen. */
  carriers: 'door-several-carriers',
  /** The carrier asks for a postcode or a tracking link. */
  input: 'door-carrier-input',
  /** An Amazon number that only the Amazon account tracks, or whose check gave no answer. */
  account: 'door-amazon-account',
  /** The server refused the input. */
  refused: 'door-refused',
  burst: 'door-limit-minute',
  daily: 'door-limit-day',
  offline: 'door-offline',
  server: 'door-server-error',
  verification: 'door-verification',
} as const;

export type DoorStop = (typeof DOOR_STOPS)[keyof typeof DOOR_STOPS];

/** Every stop the door shows right now, by the same conditions its notices are drawn on. */
export function doorStops(state: LookupState, found: Survey): DoorStop[] {
  const stops: DoorStop[] = [];
  const trouble = state.trouble;
  if (trouble && trouble.kind !== 'validation') stops.push(DOOR_STOPS[trouble.kind]);
  if (trouble?.kind === 'validation' && !found.fields.length) stops.push(DOOR_STOPS.refused);
  if (found.nothing) stops.push(DOOR_STOPS.nothing);
  if (found.order) stops.push(DOOR_STOPS.order);
  if (found.typo) stops.push(DOOR_STOPS.typo);
  if (found.several.length) stops.push(DOOR_STOPS.numbers);
  if (found.match && !found.typo && !found.several.length && found.check.status === 'several' && state.carrier === 'auto') stops.push(DOOR_STOPS.carriers);
  if (found.fields.length) stops.push(DOOR_STOPS.input);
  if (found.account === 'required' || found.account === 'unavailable') stops.push(DOOR_STOPS.account);
  return stops;
}
