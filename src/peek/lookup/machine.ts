import type { MessageKey } from '../../i18n';
import { isAmazonTrackingNumber, requiresAmazonAccount } from '../../lib/amazon';
import { carrierCheck, type CarrierCheck } from '../../lib/carrierPicker';
import {
  carrierRequirements,
  normalizeTrackingNumber,
  recognitionAskedCarriers,
  requirementSatisfied,
  type CarrierInputField,
  type CarrierInputRequirement,
  type TrackingInputMatch,
} from '../../lib/carriers';
import type { CarrierId } from '../../types';
import type { CarrierAnswer, ParcelLookupInput } from '../linkModel';
import { checkDigitTrouble, readText, type CheckDigitTrouble, type NumberInText, type Reading } from './reading';

/**
 * The front door's lookup, as a state and the events that move it. Nothing
 * here touches the network or a clock: the hook around it asks the carriers,
 * sends the lookup and counts down, and reports back with events.
 */

/** A parcel this device already follows, by its number. */
export interface DeviceParcel {
  id: string;
  /** Without spaces, dots or dashes. */
  number: string;
  carrier: CarrierId;
}

export type LookupTrouble =
  /** Too many lookups in a minute; `until` is when the next one may go. */
  | { kind: 'burst'; until: number }
  /** No lookups are left today without an account. */
  | { kind: 'daily' }
  | { kind: 'offline' }
  | { kind: 'server' }
  /** The server, or the form, refused an input. */
  | { kind: 'validation'; message: MessageKey };

/** What the door does once nothing stands in the way. */
export type LookupJob =
  | { type: 'lookup'; input: ParcelLookupInput; carrier: CarrierId }
  /** The device already follows the number: its own link opens, and no lookup is spent. */
  | { type: 'open'; id: string };

export interface LookupState {
  /** What the field holds. */
  text: string;
  /** The text as it stood when typing last paused, or right after a paste. */
  settled: string;
  /**
   * Whether the visitor wants to go on: `paste` goes straight on only when the
   * carrier is certain and nothing else is needed, `track` (the button, Enter)
   * goes on unless something has to be asked first.
   */
  intent: 'none' | 'paste' | 'track';
  /** The number chosen among several in one text. */
  pick: string | null;
  /** A carrier chosen by hand. */
  carrier: CarrierId | 'auto';
  /** What the carriers asked for, kept apart so a postcode typed for one never goes to another. */
  inputs: Partial<Record<CarrierId, Partial<Record<CarrierInputField, string>>>>;
  /** The number whose carriers may be asked: set by a paste, by leaving the field and by Track, never by a keystroke. */
  asked: string | null;
  answer: CarrierAnswer | null;
  /** The number to track as typed although its check digit does not add up. */
  asTyped: string | null;
  /** Track was pressed: what is wrong with the input shows without waiting for a pause. */
  raised: boolean;
  /** The carrier and number whose inputs the visitor has had in front of them. */
  offered: string | null;
  job: LookupJob | null;
  trouble: LookupTrouble | null;
  /** Why the Paste button could not paste. */
  paste: 'blocked' | 'empty' | null;
  /** Counts the times going on stopped at something the visitor has to settle, so the screen can lead them to it. */
  halted: number;
}

export type LookupEvent =
  | { type: 'edit'; text: string; via: 'typing' | 'paste' }
  | { type: 'pause'; text: string }
  | { type: 'blur' }
  | { type: 'submit' }
  | { type: 'answer'; answer: CarrierAnswer }
  | { type: 'pick'; number: string }
  | { type: 'choose'; carrier: CarrierId | 'auto' }
  | { type: 'fill'; carrier: CarrierId; field: CarrierInputField; value: string }
  | { type: 'asTyped' }
  | { type: 'recheck' }
  | { type: 'failed'; trouble: LookupTrouble }
  | { type: 'done' }
  | { type: 'cooled' }
  | { type: 'online' }
  | { type: 'pasteFailed'; reason: 'blocked' | 'empty' };

export function initialLookup(text = ''): LookupState {
  return {
    text, settled: text, intent: 'none', pick: null, carrier: 'auto', inputs: {}, asked: null, answer: null,
    asTyped: null, raised: false, offered: null, job: null, trouble: null, paste: null, halted: 0,
  };
}

/** Everything the screen and the next step need to know about the state. */
export interface Survey {
  reading: Reading;
  /** The numbers to choose from when the text names several. */
  several: NumberInText[];
  /** The number in play, as written; null when there is none to track. */
  match: TrackingInputMatch | null;
  normalized: string;
  /** Say that the text holds no tracking number. */
  nothing: boolean;
  /** Say that this is an Amazon order number. */
  order: boolean;
  /** Ask about the check digit. */
  typo: CheckDigitTrouble | null;
  onDevice: DeviceParcel | null;
  amazon: boolean;
  /** An Amazon number: still being checked, tracked in the Amazon account only, or the check gave no answer. */
  account: 'checking' | 'required' | 'unavailable' | null;
  check: CarrierCheck;
  /** The carrier the lookup would name; `unknown` leaves it to the server. */
  carrier: CarrierId;
  /** Where the carrier comes from. */
  source: 'device' | 'chosen' | 'found' | 'shape' | 'none';
  /** The carrier is known well enough for a paste to go straight on. */
  certain: boolean;
  /** The inputs to show for the carrier. */
  fields: CarrierInputRequirement[];
  /** The first input that is required and not filled in properly. */
  missing: CarrierInputRequirement | null;
  input(field: CarrierInputField): string;
  /** The number whose carriers should be asked now. */
  ask: string | null;
  /** The first thing the visitor has to settle before a lookup can go. */
  need: 'number' | 'order' | 'typo' | 'carrier' | 'account' | 'input' | 'wait' | null;
}

const offer = (carrier: CarrierId, normalized: string) => `${carrier}:${normalized}`;

export function survey(state: LookupState, device: readonly DeviceParcel[] = []): Survey {
  const reading = readText(state.text);
  const calm = state.raised ? reading : readText(state.settled);
  const several = reading.numbers;
  const picked = several.find((number) => number.normalized === state.pick) ?? several[0];
  const order = !picked && reading.order;
  const match = picked?.match ?? (!order && reading.match.trackingNumber ? reading.match : null);
  const normalized = match ? normalizeTrackingNumber(match.trackingNumber) : '';
  const written = Boolean(state.text.trim());
  // Half-typed input is not a mistake: these notices wait until the text has rested and still says the same.
  const nothing = written && !match && !order && Boolean(state.settled.trim() || state.raised)
    && !calm.match.trackingNumber && !calm.order && calm.numbers.length === 0;
  const onDevice = match
    ? device.find((parcel) => parcel.number === normalized && (state.carrier === 'auto' || parcel.carrier === state.carrier)) ?? null
    : null;
  const settledNumber = normalizeTrackingNumber(calm.match.trackingNumber);
  // A number the device follows was accepted once already; nobody is asked about its check digit again.
  const flaw = match && !picked && !onDevice && state.asTyped !== normalized ? checkDigitTrouble(normalized) : null;
  const typo = flaw && (state.raised || checkDigitTrouble(settledNumber)) ? flaw : null;

  const amazon = Boolean(match) && isAmazonTrackingNumber(normalized);
  const answer = match && state.answer?.trackingNumber === normalized ? state.answer : undefined;
  const settledForAsking = Boolean(match) && state.asked === normalized;
  const recognizable = Boolean(match) && !amazon && match!.confidence === 'low' && match!.carrier === 'unknown';
  // A carrier chosen by hand needs no asking; an answer that came before the choice still shows who knows the number.
  const check = carrierCheck({
    applies: recognizable && (state.carrier === 'auto' || answer !== undefined),
    settled: settledForAsking,
    asked: recognizable ? recognitionAskedCarriers(normalized) as CarrierId[] : [],
    answer,
  });

  const shipping = amazon && answer?.carrier === 'amazon-shipping'
    && ['available', 'expired'].includes(answer.amazonShippingStatus ?? '');
  const account: Survey['account'] = !match || onDevice ? null
    : amazon ? shipping ? null : !answer ? settledForAsking ? 'checking' : null
      : answer.amazonShippingStatus === 'unavailable' ? 'unavailable' : 'required'
      : state.carrier !== 'auto' && requiresAmazonAccount(state.carrier) ? 'required' : null;

  const shape = match && match.confidence === 'high' && match.carrier !== 'unknown' ? match.carrier : null;
  const [carrier, source]: [CarrierId, Survey['source']] = !match ? ['unknown', 'none']
    : onDevice ? [onDevice.carrier, 'device']
      : amazon ? [shipping ? 'amazon-shipping' : 'amazon-logistics', shipping ? 'found' : 'shape']
        : state.carrier !== 'auto' ? [state.carrier, 'chosen']
          : check.status === 'found' ? [check.carrier, 'found']
            : shape ? [shape, 'shape'] : ['unknown', 'none'];
  const certain = source !== 'none' && !(amazon && !shipping);

  const requirements = match && !onDevice && carrier !== 'unknown' ? carrierRequirements(carrier, match.trackingNumber) : [];
  const pastedUrl = match && match.carrier === carrier ? match.trackingUrl : undefined;
  const input = (field: CarrierInputField) => field === 'trackingUrl' && pastedUrl ? pastedUrl : state.inputs[carrier]?.[field] ?? '';
  // A link that came with the paste needs no field of its own.
  const fields = requirements.filter((requirement) =>
    !(requirement.field === 'trackingUrl' && pastedUrl && requirementSatisfied(requirement, pastedUrl)));
  const missing = requirements.find((requirement) => !requirementSatisfied(requirement, input(requirement.field))) ?? null;

  const ask = match && !onDevice && !state.job && settledForAsking && !answer && (amazon || (recognizable && state.carrier === 'auto')) ? normalized : null;
  const need: Survey['need'] = order ? 'order' : !match ? 'number' : typo ? 'typo' : onDevice ? null
    : account === 'checking' || check.status === 'asking' ? 'wait'
      : account ? 'account'
        : check.status === 'several' && state.carrier === 'auto' ? 'carrier'
          : missing ? 'input' : null;

  return {
    reading, several, match, normalized, nothing, order: order && (state.raised || calm.order), typo, onDevice, amazon, account,
    check, carrier, source, certain, fields, missing, input, ask, need,
  };
}

/** What the lookup sends: the number, the carrier when one is known, and the inputs that carrier asked for. */
function lookupInput(found: Survey): ParcelLookupInput {
  const wanted = (field: CarrierInputField) =>
    carrierRequirements(found.carrier, found.match!.trackingNumber).some((requirement) => requirement.field === field);
  const trackingUrl = wanted('trackingUrl') ? found.input('trackingUrl').trim() : found.match!.carrier === found.carrier ? found.match!.trackingUrl : undefined;
  const dpdPostcode = wanted('dpdPostcode') ? found.input('dpdPostcode').trim() : undefined;
  return {
    trackingNumber: found.normalized,
    ...(found.carrier !== 'unknown' ? { carrier: found.carrier } : {}),
    ...(trackingUrl ? { trackingUrl } : {}),
    ...(dpdPostcode ? { dpdPostcode } : {}),
  };
}

/** Goes on with what the visitor asked for, as far as the state allows: waits, stops to ask, or starts the job. */
function advance(state: LookupState, device: readonly DeviceParcel[]): LookupState {
  if (state.job || state.intent === 'none') return state;
  const found = survey(state, device);
  const track = state.intent === 'track';
  const stop = (changes: Partial<LookupState> = {}): LookupState => ({ ...state, intent: 'none', halted: state.halted + 1, ...changes });
  if (!found.match || found.typo || state.trouble?.kind === 'burst') return stop();
  if (found.onDevice) return { ...state, intent: 'none', trouble: null, job: { type: 'open', id: found.onDevice.id } };
  // Several numbers, or several carriers, are the visitor's choice: a paste never makes it for them.
  if (found.several.length && !track) return stop();
  if (found.need === 'wait') return state;
  if (found.need === 'account' || found.need === 'carrier') return stop();
  if (found.fields.length || found.missing) {
    const offered = offer(found.carrier, found.normalized);
    if (!track) return stop({ offered });
    if (found.missing) {
      return stop({ offered, trouble: { kind: 'validation', message: found.missing.field === 'trackingUrl' ? 'error.trackingLink' : 'error.postcode' } });
    }
    // The carrier only just turned out to want something: the visitor gets to see the field before the lookup goes.
    if (state.offered !== offered) return stop({ offered });
  }
  if (!track && !found.certain) return stop();
  return { ...state, intent: 'none', trouble: null, job: { type: 'lookup', input: lookupInput(found), carrier: found.carrier } };
}

/** A limit outlasts an edit: the countdown and the day's refusal are about the network, not about the text. */
const lasting = (trouble: LookupTrouble | null) => trouble?.kind === 'burst' || trouble?.kind === 'daily' ? trouble : null;

export function lookupStep(state: LookupState, event: LookupEvent, device: readonly DeviceParcel[] = []): LookupState {
  switch (event.type) {
    case 'edit': {
      if (state.job) return state;
      const before = survey(state, device).normalized;
      let next: LookupState = { ...state, text: event.text, intent: 'none', raised: false, paste: null, trouble: lasting(state.trouble) };
      const after = survey(next, device);
      if (!after.several.some((number) => number.normalized === next.pick)) next = { ...next, pick: null };
      // A carrier chosen by hand was chosen for the number it stood beside.
      if (after.normalized !== before) next = { ...next, carrier: 'auto' };
      if (event.via !== 'paste') return next;
      return advance({ ...next, settled: event.text, asked: after.normalized || null, intent: 'paste' }, device);
    }
    case 'pause':
      return event.text === state.text && state.settled !== state.text ? { ...state, settled: state.text } : state;
    case 'blur': {
      const { normalized } = survey(state, device);
      return normalized && state.asked !== normalized ? { ...state, asked: normalized } : state;
    }
    case 'submit': {
      if (state.job || state.trouble?.kind === 'burst') return state;
      const before = survey(state, device);
      return advance({
        ...state,
        settled: state.text,
        raised: true,
        intent: 'track',
        paste: null,
        trouble: null,
        asked: before.normalized || state.asked,
        // Pressing Track with the question about the check digit in view answers it: track it as typed.
        asTyped: before.typo ? before.normalized : state.asTyped,
        offered: before.fields.length ? offer(before.carrier, before.normalized) : state.offered,
      }, device);
    }
    case 'asTyped': {
      if (state.job) return state;
      const { normalized } = survey(state, device);
      return advance({ ...state, settled: state.text, raised: true, intent: 'track', trouble: lasting(state.trouble), asked: normalized || state.asked, asTyped: normalized }, device);
    }
    case 'answer':
      return event.answer.trackingNumber === state.asked ? advance({ ...state, answer: event.answer }, device) : state;
    case 'recheck':
      return state.answer ? { ...state, answer: null } : state;
    case 'pick':
      return state.job ? state : { ...state, pick: event.number, carrier: 'auto', asked: event.number, intent: 'none', trouble: lasting(state.trouble) };
    case 'choose':
      return state.job ? state : { ...state, carrier: event.carrier, intent: 'none', trouble: lasting(state.trouble) };
    case 'fill':
      return state.job ? state : {
        ...state,
        inputs: { ...state.inputs, [event.carrier]: { ...state.inputs[event.carrier], [event.field]: event.value } },
        trouble: state.trouble?.kind === 'validation' ? null : state.trouble,
      };
    case 'failed':
      return { ...state, job: null, intent: 'none', trouble: event.trouble };
    case 'done':
      return state.job ? { ...state, job: null, intent: 'none' } : state;
    case 'cooled':
      return state.trouble?.kind === 'burst' ? { ...state, trouble: null } : state;
    case 'online':
      return state.trouble?.kind === 'offline' ? { ...state, trouble: null } : state;
    case 'pasteFailed':
      return { ...state, paste: event.reason };
  }
}

/**
 * What stands in for the carriers' answer when none came: the number stays a
 * suggestion, the lookup still works, and the first check asks again.
 */
export function unanswered(number: string): CarrierAnswer {
  if (isAmazonTrackingNumber(number)) return { trackingNumber: number, carrier: 'amazon-logistics', amazonShippingStatus: 'unavailable' };
  const asked = recognitionAskedCarriers(number) as CarrierId[];
  return { trackingNumber: number, carrier: 'unknown', ...(asked.length ? { asked, unanswered: asked } : {}) };
}

/** Seconds left on the countdown, never less than one while it runs. */
export function secondsLeft(trouble: LookupTrouble | null, now: number): number {
  return trouble?.kind === 'burst' ? Math.max(0, Math.ceil((trouble.until - now) / 1_000)) : 0;
}

/** "0:42", the way a countdown is read. */
export function countdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
