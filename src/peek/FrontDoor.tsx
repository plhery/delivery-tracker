import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import { CarrierPickerSheet } from '../components/CarrierPickerSheet';
import { Icon } from '../components/Icon';
import { PeekLockup } from '../components/PeekMark';
import { useI18n } from '../i18n';
import { trackAction, trackScreen } from '../lib/analytics';
import { carrierBrand } from '../lib/carrierBrand';
import { carrierChoiceSections, carrierChoiceTags, shapeCarrier, usedCarrierIds } from '../lib/carrierPicker';
import { carrierInfo, formatTrackingNumber } from '../lib/carriers';
import { focusClickedButton } from '../lib/modal';
import type { CarrierId } from '../types';
import { CarrierRibbon } from './landing/CarrierRibbon';
import { LandingIcon } from './landing/glyphs';
import { HeroPip } from './landing/HeroPip';
import { Landing } from './landing/Landing';
import { LandingFooter } from './landing/Who';
import { followInPlace, SOURCE_URL } from './landing/links';
import { SAMPLE_COUNT, SampleLine, SampleText } from './landing/Sample';
import { useLive, useReducedMotion } from './landing/useLive';
import { useSampleLoop } from './landing/useSampleLoop';
import { startSample, type ParcelLinkView, type ParcelLookup } from './links';
import { DeviceParcels } from './lookup/DeviceParcels';
import { DoorIcon } from './lookup/DoorNote';
import { LookupFeedback } from './lookup/LookupFeedback';
import { countdown } from './lookup/machine';
import { looksLikeNumber } from './lookup/reading';
import { useLookup } from './lookup/useLookup';
import { useRecents } from './recents';
import { usePeekSession } from './session';
import './FrontDoor.css';

const subscribeToHydration = () => () => undefined;

/** What the door hands over the moment a lookup answers. */
export interface TrackedParcel {
  id: string;
  /** The owner key, given this once. */
  key: string;
  carrier: CarrierId;
  response: ParcelLinkView;
}

/**
 * The front door, and the landing it opens: one field that takes a number, a
 * link or a pasted message, recognises the carrier, asks for what is missing,
 * and opens the parcel's own page. Right under it stand the parcels this
 * device already looked up. A first visit gets the whole first screen: the
 * field shows what it takes until someone touches it, and Pip opens a sample
 * parcel. Below, three more sections answer what a visitor asks next.
 */
export function FrontDoor({ onTracked, onSample, onSignIn }: {
  onTracked: (tracked: TrackedParcel) => void;
  /** Pip's box is open: the sample parcel takes the door's place. */
  onSample: (sample: ParcelLinkView) => void;
  onSignIn: () => void;
}) {
  const { t, locale } = useI18n();
  const { account, email, openDeliveries } = usePeekSession();
  // Someone signed in reads the landing at its own address: the way back to their deliveries stands where signing in does.
  const mine = account === 'signed-in' && openDeliveries;
  const initial = email?.trim().charAt(0).toUpperCase();
  const recents = useRecents();
  // With parcels on this device the first screen is theirs: the field, then the list.
  const firstVisit = recents.length === 0;
  // The buttons wait for the page to be live; what was typed into the field before that stays.
  const ready = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const lookup = useLookup(useCallback(({ id, key, view }: ParcelLookup) =>
    onTracked({ id, key, carrier: view.parcel.carrier, response: view }), [onTracked]));
  const { state, found, retryIn, send } = lookup;
  const form = useRef<HTMLFormElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const pasting = useRef(false);
  const [picking, setPicking] = useState(false);
  const hero = useRef<HTMLElement>(null);
  const live = useLive(hero);
  const still = useReducedMotion();
  // The field shows itself until someone touches it, and never again.
  const [touched, setTouched] = useState(false);
  const [unboxing, setUnboxing] = useState(false);
  // The sample is read while the box opens, so its page opens with it.
  const sample = useRef<Promise<ParcelLinkView> | null>(null);
  const touch = useCallback(() => setTouched(true), []);
  const written = Boolean(state.text.trim());
  const beat = useSampleLoop(SAMPLE_COUNT, ready && firstVisit && !touched && !written && !unboxing && !still && live);

  // While a saved sign-in is still being looked for, nobody may be looking at the door.
  useEffect(() => { if (account !== 'checking') trackScreen('front-door', account === 'signed-in' ? 'account' : 'anonymous'); }, [account]);

  // The tab asks the page's question, in the reader's language. Whatever follows the landing is the app again.
  useEffect(() => {
    document.title = `${t('app.title')} — ${t('peek.title')}`;
    return () => { document.title = `${t('app.title')} — ${t('app.tagline')}`; };
  }, [t]);

  // The field is the browser's own until the page is live: what was typed meanwhile is read once.
  useEffect(() => {
    const typed = field.current?.value;
    if (!typed) return;
    touch();
    send({ type: 'edit', text: typed, via: 'typing' });
  }, [send, touch]);

  // One line fits a number; the field grows for a pasted link or message.
  useLayoutEffect(() => {
    const input = field.current;
    if (!input) return;
    input.style.height = '';
    input.style.height = `${input.scrollHeight}px`;
  }, [state.text]);

  /** Puts a text in the field as if it had been pasted there. */
  const put = useCallback((text: string) => {
    if (field.current) field.current.value = text;
    touch();
    send({ type: 'edit', text, via: 'paste' });
  }, [send, touch]);

  // Where going on stopped is where the visitor continues: the choice to make or the input to give.
  // Without either, the focus stays where it is; only a focus left nowhere is brought back.
  const halted = useRef(state.halted);
  const led = useRef(false);
  useEffect(() => {
    if (halted.current === state.halted && !led.current) return;
    halted.current = state.halted;
    led.current = false;
    if (state.trouble && state.trouble.kind !== 'validation') return;
    const within = (selector: string) => form.current?.querySelector<HTMLElement>(selector);
    const asked = found.several.length ? within('.door-numbers input:checked')
      : found.need === 'carrier' ? within('.door-carriers input')
        : found.fields.length && found.match && !found.typo ? within('.door-input input[aria-invalid]') ?? within('.door-input input')
          : null;
    if (asked) asked.focus();
    else if (!form.current?.contains(document.activeElement)) (within('.door-action:not([data-idle]) button:enabled') ?? field.current)?.focus();
  });

  async function paste() {
    touch();
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      send({ type: 'pasteFailed', reason: 'blocked' });
      field.current?.focus();
      return;
    }
    if (!text.trim()) {
      send({ type: 'pasteFailed', reason: 'empty' });
      field.current?.focus();
      return;
    }
    trackAction('parcel-paste', 'success');
    put(text);
  }

  function track(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const typed = field.current?.value ?? '';
    if (typed !== state.text) send({ type: 'edit', text: typed, via: 'typing' });
    send({ type: 'submit' });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter tracks; a new line in a message takes Shift.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    form.current?.requestSubmit();
  }

  const opening = state.job?.type === 'lookup';
  const busy = Boolean(state.job);
  const carrier = carrierInfo(found.carrier, locale);
  const named = Boolean(found.match) && found.source !== 'none' && found.carrier !== 'unknown' && found.carrier !== 'intl-post';
  const number = found.match ? formatTrackingNumber(found.match.trackingNumber, found.carrier) : '';
  const choosingCarrier = Boolean(found.match) && !found.typo && !found.several.length && found.check.status === 'several';
  const note = Boolean(state.paste) || (state.trouble !== null && state.trouble.kind !== 'validation');
  // Pip keeps the plain moments company; a question or a note takes its place.
  const panel = note || found.nothing || found.order || Boolean(found.typo) || found.several.length > 0 || choosingCarrier
    || found.fields.length > 0 || found.account === 'required' || found.account === 'unavailable';
  const pip = !panel && (written || firstVisit);
  const waiting = state.trouble?.kind === 'burst';
  const label = waiting ? t('door.burst.retry', { time: countdown(retryIn) })
    : found.several.length ? t('door.several.track')
      : found.onDevice ? t('link.open')
        : choosingCarrier && state.carrier !== 'auto' ? t('door.ambiguous.track', { carrier: carrier.name })
          : state.trouble?.kind === 'server' || state.trouble?.kind === 'offline' ? t('app.tryAgain') : t('peek.track');
  // On a phone the button stands at the foot of the screen once there is something to track.
  const idle = !written || busy || found.need === 'number' || found.need === 'order' || found.need === 'account';
  const invalid = found.nothing || Boolean(found.typo) || (state.trouble?.kind === 'validation' && !found.fields.length);
  const canPaste = !ready || (typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function');
  const pasteFirst = firstVisit && !written && canPaste;
  // Pip hops when a carrier answers: the sample's, or the one that knows the number in the field.
  const answered = named ? `${found.carrier}:${found.normalized}` : beat.phase === 'found' ? `sample:${beat.index}` : '';
  const pointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'keys';
  const tone = named ? {
    ...carrierBrand(carrier).style,
    '--tone': 'light-dark(var(--carrier-ink-light), var(--carrier-ink-dark))',
    '--tone-surface': 'light-dark(var(--carrier-surface-light), var(--carrier-surface-dark))',
  } as CSSProperties : undefined;

  return <div className="door" style={tone} data-view={firstVisit ? 'first' : 'device'} data-engaged={written || undefined} onClickCapture={focusClickedButton}>
    <header className="door-header">
      <PeekLockup />
      <div className="door-header__actions">
        <a className="door-github" href={SOURCE_URL} target="_blank" rel="noopener noreferrer"><LandingIcon name="github" />GitHub</a>
        {mine
          // eslint-disable-next-line @next/next/no-html-link-for-pages -- followed in place: the app itself answers at `/`
          ? <a className="door-signin door-mine" href="/" onClick={(event) => followInPlace(event, () => mine())}>
            <span className="door-mine__avatar" aria-hidden="true">{initial || <Icon name="account" />}</span>{t('landing.mine')}
          </a>
          : <button type="button" className="door-signin" disabled={!ready} onClick={onSignIn}>{t('arrival.signInTitle')}</button>}
      </div>
    </header>
    <main>
      <section ref={hero} className="door-hero" aria-labelledby="door-title" data-resting={(ready && !live) || undefined}>
        {opening && named && <div className="door-wash" aria-hidden="true" />}
        <div className="door-body">
          {firstVisit && <a className="door-pill" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            {/* The spaces are for a screen reader: the dot between the two says nothing. */}
            <LandingIcon name="github" />{t('link.source')}{' '}<span className="door-pill__dot" aria-hidden="true" />{' '}{t('landing.pill.carriers')}
          </a>}
          <h1 id="door-title">{t('peek.title')}</h1>
          {firstVisit && <p className="door-lead">{t('landing.lead')}</p>}
          <form ref={form} className="door-form" noValidate onSubmit={track}>
            <div className="door-entry">
              <div className="door-field" data-invalid={invalid || undefined}>
                <label htmlFor="door-tracking" className="sr-only">{t('add.tracking')}</label>
                <span className="door-field__input" hidden={opening}><textarea ref={field} id="door-tracking" rows={1} placeholder={t('add.trackingPlaceholder')}
                  data-number={looksLikeNumber(state.text) || undefined} readOnly={busy}
                  autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="go"
                  aria-describedby={invalid ? 'door-message' : undefined} aria-invalid={invalid ? true : undefined}
                  onFocus={touch}
                  onPaste={() => {
                    pasting.current = true;
                    // A paste that changes nothing must not make the next keystroke look pasted.
                    setTimeout(() => { pasting.current = false; });
                  }}
                  onInput={(event) => {
                    touch();
                    send({ type: 'edit', text: event.currentTarget.value, via: pasting.current ? 'paste' : 'typing' });
                    pasting.current = false;
                  }}
                  onBlur={() => send({ type: 'blur' })}
                  onKeyDown={onKeyDown} />
                  {/* Browsers cut a long placeholder off mid-letter in a multi-line field; this one ends in an ellipsis. */}
                  <span className="door-field__placeholder" aria-hidden="true">{t('add.trackingPlaceholder')}</span>
                  {firstVisit && !written && <SampleText beat={beat} />}
                </span>
                {opening && <span className="door-field__number">{number}</span>}
                {opening && <span className="door-field__check"><Icon name="check" /></span>}
                {!written && canPaste && <button type="button" className="door-paste" disabled={!ready} data-press={beat.phase === 'paste' || undefined}
                  onClick={() => void paste()}><DoorIcon name="clipboard" />{t('add.paste')}</button>}
              </div>
              <div className="door-action" data-idle={idle || undefined} data-paste={pasteFirst || undefined}>
                <button type="submit" className={`button ${waiting ? 'button--secondary' : 'button--primary'}`} disabled={!ready || busy || waiting}>{label}</button>
                {/* A phone's first visit has one button for both: it pastes, and what was pasted is tracked. It stands where Track will. */}
                {pasteFirst && <button type="button" className="button button--primary door-action__paste" disabled={!ready} onClick={() => void paste()}>
                  <DoorIcon name="clipboard" />{t('landing.pasteAndTrack')}
                </button>}
              </div>
            </div>
            {/* The carrier's line has its place from the start, so neither a sample nor an answer moves what is below. */}
            <div className="door-says">
              {firstVisit && !written && <SampleLine beat={beat} />}
              <LookupFeedback lookup={lookup} pointer={pointer} onSignIn={onSignIn} onPickCarrier={() => setPicking(true)} onSuggestion={put} />
            </div>
          </form>
          <p className="sr-only" role="status">{opening ? t('door.opening') : ''}</p>
          {pip && <HeroPip label={named ? { carrier, number } : undefined} sample={firstVisit && !written} happy={beat.phase === 'found'}
            hop={answered} onOpening={() => { setUnboxing(true); sample.current = startSample(locale); }}
            onOpen={() => void sample.current?.then(onSample)} />}
          {opening && <div className="door-skeleton" aria-hidden="true"><span /><span /><span /></div>}
          <DeviceParcels onSignIn={onSignIn} onForgotten={() => field.current?.focus()} />
        </div>
        <CarrierRibbon />
      </section>
      <Landing onSignIn={onSignIn} />
    </main>
    <LandingFooter />
    {picking && found.match && <CarrierPickerSheet
      selected={state.carrier}
      auto={{
        description: found.check.status === 'asking' ? t('add.recognizing')
          : found.check.status === 'found' ? t('add.recognized', { carrier: carrierInfo(found.check.carrier, locale).name })
            : shapeCarrier(found.match) ? t('picker.auto.detected', { carrier: carrierInfo(found.match.carrier, locale).name })
              : t('door.picker.auto'),
        recommended: true,
        busy: found.check.status === 'asking',
      }}
      sections={carrierChoiceSections({
        detection: found.match,
        check: found.check,
        // The carriers of the parcels on this device stand in for "used before".
        used: usedCarrierIds(recents.map((recent) => ({ carrier: recent.carrier, createdAt: recent.lastSeenAt })), (id) => carrierInfo(id).capabilities.selectable),
        t,
      })}
      tags={carrierChoiceTags(found.check, t)}
      onSelect={(choice) => {
        send({ type: 'choose', carrier: choice });
        setPicking(false);
        // A carrier that asks for something leads straight to its field.
        led.current = true;
      }}
      onClose={() => setPicking(false)}
    />}
  </div>;
}
