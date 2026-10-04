import type { ReactNode } from 'react';
import { CarrierMark, CarrierTruck } from '../../components/CarrierMark';
import { Icon } from '../../components/Icon';
import { useI18n, type MessageKey } from '../../i18n';
import { amazonOrdersUrl } from '../../lib/amazon';
import { carrierBrand } from '../../lib/carrierBrand';
import { carrierNameList } from '../../lib/carrierPicker';
import { carrierInfo, carrierTrackingHintKey, formatTrackingNumber, tracksAutomatically } from '../../lib/carriers';
import type { CarrierId } from '../../types';
import { usePeekSession } from '../session';
import { DoorNote } from './DoorNote';
import { FoundNumber } from './FoundNumber';
import type { Lookup } from './useLookup';

/** The four shapes most visitors hold in their hands, shown when the text has no number. */
const SHAPES: readonly (readonly [CarrierId, MessageKey])[] = [
  ['ups', 'door.shapes.ups'], ['dhl', 'door.shapes.dhl'], ['swiss-post', 'door.shapes.swissPost'], ['dpd', 'door.shapes.dpd'],
];

/** The line names this many of the carriers being asked; the ellipsis stands for the rest. */
const ASKED_NAMED = 3;

/** A sentence around the value it names, so the value can be set in its own type. */
function around(sentence: (value: string) => string): [string, string] {
  const [before = '', after = ''] = sentence('\u0000').split('\u0000');
  return [before, after];
}

/**
 * Everything the door says back about what the field holds: the number it
 * read, the carrier, the choices and inputs it needs, and what went wrong.
 * The carrier's line keeps its place and height from the moment a number is
 * read, whatever the carriers answer.
 */
export function LookupFeedback({ lookup, pointer, onSignIn, onPickCarrier, onSuggestion }: {
  lookup: Lookup;
  /** How this visitor points, which decides how pasting by hand is explained. */
  pointer: 'touch' | 'keys';
  onSignIn: () => void;
  onPickCarrier: () => void;
  /** Takes the suggested number instead of the typed one. */
  onSuggestion: (number: string) => void;
}) {
  const { t, locale, languageTag } = useI18n();
  const { account, openDeliveries } = usePeekSession();
  // Someone signed in is not asked to sign in: what an account is for is in their deliveries.
  const mine = account === 'signed-in' && openDeliveries;
  const { state, found, send } = lookup;
  const { match, check, typo, several } = found;
  const opening = state.job?.type === 'lookup';
  const carrier = carrierInfo(found.carrier, locale);
  const announce = state.raised ? 'alert' : 'status';
  const validation = state.trouble?.kind === 'validation' ? state.trouble.message : null;
  // What a carrier asked for is corrected beside its own field.
  const inputTrouble = validation && found.fields.length > 0 && (validation === 'error.postcode' || validation === 'error.trackingLink');
  const message = validation && !inputTrouble ? t(validation) : found.nothing ? t('add.notFound') : null;

  let line: ReactNode = null;
  if (match && !typo && several.length === 0) {
    const truck = <CarrierTruck carrier={carrier} />;
    const detect = (busy = false) => <span className={`door-line__detect${busy ? ' is-busy' : ''}`}><Icon name="detect" /></span>;
    const rested = state.settled === state.text || state.asked === found.normalized;
    const said: { mark: ReactNode; strong: string; detail: string; attention?: boolean } | null =
      found.source === 'device' ? { mark: truck, strong: carrier.name, detail: t('door.line.onDevice') }
        : found.amazon ? { mark: truck, strong: carrier.name, detail: t('add.detectedCarrier') }
          : check.status === 'asking' ? { mark: detect(true), strong: t('door.line.finding'), detail: t('add.line.asking', { carriers: carrierNameList(check.asked.slice(0, ASKED_NAMED), locale, languageTag) }) }
            : check.status === 'several' ? { mark: detect(), strong: t('door.line.several.many', { count: check.carriers.length }), detail: t('door.line.chooseYours'), attention: true }
              : found.source !== 'none' ? { mark: truck, strong: carrier.name, detail: t(found.source === 'chosen' ? 'add.line.chosen' : found.source === 'found' ? 'add.line.found' : 'add.detectedCarrier') }
                : rested ? { mark: detect(), strong: t('add.carrier'), detail: t(check.status === 'none' ? 'add.line.none' : 'door.line.later') }
                  : null;
    // The way to the picker stays put while the carriers are asked: leaving the field starts the asking, and a
    // button that left with it would take the click along.
    const changeable = !state.job && found.source !== 'device' && !found.amazon && check.status !== 'several' && Boolean(said);
    line = <div className="door-line" aria-live="polite" aria-busy={check.status === 'asking' || found.account === 'checking'}>
      {said && <>
        {said.mark}
        <span className="door-line__text">
          <strong>{said.strong}</strong>{' '}
          <small className={said.attention ? 'is-attention' : undefined}>{said.detail}</small>
          {opening && <small className="door-line__opening" aria-hidden="true">· {t('door.line.opening')}</small>}
        </span>
        {changeable && <button type="button" className="door-line__change" aria-haspopup="dialog" onClick={onPickCarrier}>{t('add.line.change')}</button>}
      </>}
    </div>;
  }

  const picked = several.find((number) => number.normalized === state.pick) ?? several[0];
  const [beforeSuggestion, afterSuggestion] = around((number) => t('door.typo.suggest', { number }));
  const answer = state.answer?.trackingNumber === found.normalized ? state.answer : null;
  const trouble = state.trouble && state.trouble.kind !== 'validation' ? state.trouble.kind : null;

  return <div className="door-feedback">
    {message && <p id="door-message" className="door-message" role={announce}>{message}</p>}
    {match && several.length === 0 && match.source !== 'number'
      && <FoundNumber className="door-found" number={formatTrackingNumber(match.trackingNumber, found.carrier)} source={match.source === 'link' ? 'link' : 'text'} />}
    {line}

    {typo && <div className="door-typo">
      <p id="door-message" className="door-message" role={announce}>
        {t('door.typo.check')} {t(typo.suggestion ? 'door.typo.letter' : 'door.typo.compare')}
      </p>
      {typo.suggestion && <button type="button" className="door-suggestion" onClick={() => onSuggestion(typo.suggestion!)}>
        {beforeSuggestion}
        <span className="door-suggestion__number">{[...typo.suggestion].map((character, index) =>
          character === found.normalized[index] ? character : <mark key={index}>{character}</mark>)}</span>
        {afterSuggestion}
      </button>}
      <button type="button" className="door-as-typed" onClick={() => send({ type: 'asTyped' })}>{t('door.typo.asTyped')}</button>
    </div>}

    {several.length > 0 && <fieldset className="door-numbers">
      <legend>{t('door.several.title.many', { count: several.length })}</legend>
      {several.map(({ normalized, match: number }) => {
        const info = carrierInfo(number.carrier, locale);
        return <label key={normalized} className="door-number" data-checked={picked.normalized === normalized || undefined}>
          <input type="radio" name="door-number" checked={picked.normalized === normalized} disabled={Boolean(state.job)}
            onChange={() => send({ type: 'pick', number: normalized })} />
          <CarrierTruck carrier={info} />
          <span className="door-number__text"><strong>{info.name}</strong><span>{formatTrackingNumber(number.trackingNumber, number.carrier)}</span></span>
        </label>;
      })}
      {!mine && <p className="door-aside">{t('door.several.question')} <button type="button" className="door-link" onClick={onSignIn}>{t('door.several.signIn')}</button></p>}
    </fieldset>}

    {check.status === 'several' && line && <fieldset className="door-carriers">
      <legend className="sr-only">{t('door.line.several.many', { count: check.carriers.length })}</legend>
      {check.carriers.map((id) => {
        const info = carrierInfo(id, locale);
        return <label key={id} className="door-carrier" style={carrierBrand(info).style} data-checked={state.carrier === id || undefined}>
          <input type="radio" className="sr-only" name="door-carrier" checked={state.carrier === id} disabled={Boolean(state.job)}
            onChange={() => send({ type: 'choose', carrier: id })} />
          <CarrierMark carrier={info} />
          <span>{t('picker.tag.knows')}</span>
        </label>;
      })}
      <p className="door-aside">{t('door.ambiguous.hint')}</p>
    </fieldset>}

    {line && found.amazon && found.source === 'found'
      && <p className="door-aside">{t(answer?.amazonShippingStatus === 'expired' ? 'add.amazonHistoryExpired' : 'add.amazonShippingConfirmed')}</p>}
    {line && !found.amazon && found.source !== 'none' && found.source !== 'device' && !tracksAutomatically(found.carrier)
      && <p className="door-aside">{t(carrierTrackingHintKey(found.carrier), { carrier: carrier.name })}</p>}

    {found.fields.map((requirement) => {
      const id = `door-${requirement.field}`;
      const postcode = requirement.field === 'dpdPostcode';
      return <div key={requirement.field} className="door-input">
        <label htmlFor={id}>
          {locale === 'en' ? requirement.label : t(`add.requirement.${requirement.field}`)}
          {requirement.optional && <> <small>{t('add.optional')}</small></>}
        </label>
        <input id={id} className="door-input__field" type={requirement.type} inputMode={requirement.inputMode} autoComplete={requirement.autoComplete}
          value={found.input(requirement.field)} placeholder={requirement.placeholder} pattern={requirement.pattern} maxLength={requirement.maxLength}
          readOnly={Boolean(state.job)} required={!requirement.optional} aria-describedby={`${id}-help`}
          aria-invalid={inputTrouble && found.missing?.field === requirement.field ? true : undefined}
          autoCapitalize={requirement.type === 'url' ? 'none' : undefined} autoCorrect="off" spellCheck={false}
          onChange={(event) => send({
            type: 'fill',
            carrier: found.carrier,
            field: requirement.field,
            value: requirement.inputMode === 'numeric' ? event.target.value.replace(/\D/g, '').slice(0, requirement.maxLength) : event.target.value,
          })} />
        {inputTrouble && found.missing?.field === requirement.field && <p className="door-message" role="alert">{t(validation)}</p>}
        <p id={`${id}-help`} className="door-aside">
          {t(!postcode ? 'add.requirement.trackingUrlHelp' : requirement.optional ? 'add.requirement.dpdPostcodeOptionalHelp' : 'add.requirement.dpdPostcodeHelp', { carrier: carrier.name })}
        </p>
        <p className="door-private"><Icon name="lock" />{t('door.postcode.private', { carrier: carrier.name })}</p>
      </div>;
    })}

    {(found.account === 'required' || found.account === 'unavailable') && <DoorNote icon="receipt" tone="warm" urgent={state.raised}>
      <p>{t(found.account === 'required' ? 'add.amazonAccount' : 'add.amazonCheckUnavailable')}</p>
      {found.account === 'unavailable' && <button type="button" className="door-note__action" onClick={() => send({ type: 'recheck' })}>{t('add.amazonRetry')}</button>}
      <a className="door-note__action" href={amazonOrdersUrl(found.normalized)} target="_blank" rel="noopener noreferrer">{t('add.openAmazonOrders')}<Icon name="arrow" /></a>
    </DoorNote>}

    {found.order && <DoorNote icon="receipt" tone="warm" title={t('door.order.title')} urgent={state.raised}>
      <p>{t('door.order.body')}</p>
      <a className="door-note__action" href={amazonOrdersUrl('')} target="_blank" rel="noopener noreferrer">{t('add.openAmazonOrders')}<Icon name="arrow" /></a>
    </DoorNote>}

    {found.nothing && <section className="door-shapes" aria-labelledby="door-shapes-title">
      <h2 id="door-shapes-title">{t('door.shapes.title')}</h2>
      <ul>{SHAPES.map(([id, key]) => {
        const info = carrierInfo(id, locale);
        return <li key={id}><CarrierTruck carrier={info} /><strong>{info.name}</strong><span>{t(key)}</span></li>;
      })}</ul>
    </section>}

    {trouble === 'burst' && <DoorNote icon="hourglass" tone="warm" title={t('door.burst.title')} urgent><p>{t('door.burst.body')}</p></DoorNote>}
    {trouble === 'daily' && <DoorNote icon="hourglass" tone="warm" title={t('door.daily.title')} urgent>
      <p>{t(mine ? 'door.daily.account' : 'door.daily.body')}</p>
      <button type="button" className="door-note__action" onClick={mine ? () => mine() : onSignIn}>{t(mine ? 'landing.mine' : 'arrival.signInTitle')}</button>
    </DoorNote>}
    {trouble === 'offline' && <DoorNote icon="offline" title={t('offline.title')} urgent><p>{t('door.offline.body')}</p></DoorNote>}
    {trouble === 'server' && <DoorNote icon="refresh" tone="warm" title={t('door.trouble.title')} urgent><p>{t('door.trouble.body')}</p></DoorNote>}
    {trouble === 'verification' && <DoorNote icon="refresh" tone="warm" title={t('door.verification.title')} urgent><p>{t('door.verification.body')}</p></DoorNote>}
    {state.paste && <DoorNote icon="clipboard" title={t('door.paste.blocked.title')} urgent>
      <p>{t(state.paste === 'empty' ? 'door.paste.empty' : pointer === 'touch' ? 'door.paste.blocked.touch' : 'door.paste.blocked.keys')}</p>
    </DoorNote>}
  </div>;
}
