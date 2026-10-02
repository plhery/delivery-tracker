import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type FormEvent, type Ref } from 'react';
import { useI18n } from '../i18n';
import { trackAction } from '../lib/analytics';
import type { ApiAuth } from '../lib/apiClient';
import { lookupCarrier } from '../lib/carrierDetection';
import { carrierNameList } from '../lib/carrierPicker';
import { userErrorMessage } from '../lib/userMessages';
import { DoorIcon } from '../peek/lookup/DoorNote';
import { unanswered } from '../peek/lookup/machine';
import { looksLikeNumber } from '../peek/lookup/reading';
import { ASK_PATIENCE_MS } from '../peek/lookup/useLookup';
import { ParcelAlreadyExistsError, type CarrierId, type NewParcelInput, type ParcelWithEvents } from '../types';
import { fieldAction, followedParcels } from './deliveriesFieldAction';
import { Icon } from './Icon';
import './DeliveriesField.css';

const subscribeToHydration = () => () => undefined;
/** The line names this many of the carriers being asked, as the front door does. */
const ASKED_NAMED = 3;
const touchScreen = () => window.matchMedia?.('(pointer: coarse)').matches === true;

export interface DeliveriesFieldHandle {
  /** Brings the focus back to the field without opening a phone's keyboard. */
  focus(): void;
}

type Busy =
  | { step: 'asking'; shown: string; carriers: readonly CarrierId[] }
  | { step: 'adding'; shown: string };

/**
 * The front door's field on top of the deliveries. A paste, or Enter after
 * typing, adds the parcel at once when its carrier is certain and nothing
 * else is needed. Everything that needs a choice or an input is handed to the
 * Add sheet with the text, and a number already in the deliveries opens its
 * parcel.
 */
export function DeliveriesField({ ref, parcels, apiAuth, onAdd, onAdded, onFinishInSheet, onOpenExisting }: {
  ref?: Ref<DeliveriesFieldHandle>;
  parcels: readonly ParcelWithEvents[];
  /** Signed in, the carriers can be asked about a number whose shape several of them share. */
  apiAuth?: ApiAuth;
  /** Adds through the parcels store. */
  onAdd: (input: NewParcelInput) => Promise<ParcelWithEvents>;
  onAdded: (parcel: ParcelWithEvents) => void;
  /** Hands the text to the Add sheet; an empty text opens the empty sheet. */
  onFinishInSheet: (text: string) => void;
  onOpenExisting: (parcelId: string) => void;
}) {
  const { t, locale, languageTag } = useI18n();
  const id = useId();
  // The buttons wait for the page to be live; what was typed before that stays.
  const ready = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<Busy | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Counts the steps that ended with the field cleared, so the focus can be put back once the buttons are.
  const [cleared, setCleared] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pasteButton = useRef<HTMLButtonElement>(null);
  const working = useRef<AbortController | null>(null);
  // The steps outlive a render: they read the latest deliveries and callbacks.
  const live = useRef({ parcels, apiAuth, onAdd, onAdded, onFinishInSheet, onOpenExisting, t });
  useEffect(() => { live.current = { parcels, apiAuth, onAdd, onAdded, onFinishInSheet, onOpenExisting, t }; });
  useEffect(() => () => working.current?.abort(), []);

  // The field is the browser's own until the page is live: what was typed meanwhile is kept.
  useEffect(() => {
    const typed = input.current?.value;
    if (typed) setText(typed);
  }, []);

  /** Whether the focus is the field's to move: inside it, or nowhere. A focus that went elsewhere stays there. */
  const focusIsOurs = () => {
    const active = document.activeElement;
    return !active || active === document.body || Boolean(form.current?.contains(active));
  };
  /** The focus rests on the input, or on a touch screen on the Paste button, which opens no keyboard. */
  const rest = () => {
    if (!touchScreen()) input.current?.focus({ preventScroll: true });
    else if (pasteButton.current) pasteButton.current.focus({ preventScroll: true });
    // Nothing to rest on: the keyboard closes so the list shows.
    else input.current?.blur();
  };
  useImperativeHandle(ref, () => ({ focus: rest }), []);
  useLayoutEffect(() => {
    if (cleared && focusIsOurs()) rest();
  }, [cleared]);

  /** Asks the carriers that share the number's shape. No answer in time counts as none: the Add sheet asks again. */
  async function ask(number: string, signal: AbortSignal) {
    const auth = live.current.apiAuth;
    if (!auth) return unanswered(number);
    const asking = new AbortController();
    const stop = () => asking.abort();
    signal.addEventListener('abort', stop);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const patience = new Promise<null>((resolve) => { timer = setTimeout(resolve, ASK_PATIENCE_MS, null); });
    try {
      return await Promise.race([lookupCarrier(number, auth, asking.signal), patience]) ?? unanswered(number);
    } catch {
      return unanswered(number);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      asking.abort();
    }
  }

  async function go(source: string) {
    if (working.current) return;
    const controller = new AbortController();
    working.current = controller;
    setNote(null);
    /** The step is over and the field is empty again. */
    const clear = () => {
      working.current = null;
      setBusy(null);
      setText('');
      setCleared((count) => count + 1);
    };
    let action = fieldAction(source, followedParcels(live.current.parcels));
    if (action.type === 'ask') {
      setText(source);
      setBusy({ step: 'asking', shown: action.shown, carriers: action.carriers });
      const answer = await ask(action.number, controller.signal);
      if (controller.signal.aborted) return;
      action = fieldAction(source, followedParcels(live.current.parcels), answer);
    }
    if (action.type === 'open') {
      clear();
      live.current.onOpenExisting(action.id);
      return;
    }
    if (action.type !== 'add') {
      clear();
      live.current.onFinishInSheet(source.trim() ? source : '');
      return;
    }
    setText(source);
    setBusy({ step: 'adding', shown: action.shown });
    try {
      const parcel = await live.current.onAdd(action.input);
      if (controller.signal.aborted) return;
      clear();
      live.current.onAdded(parcel);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ParcelAlreadyExistsError) {
        clear();
        live.current.onOpenExisting(error.parcelId);
        return;
      }
      // The text stays, to try again or to correct.
      working.current = null;
      setBusy(null);
      setNote(userErrorMessage(error, live.current.t, 'add.failed'));
      if (focusIsOurs()) input.current?.focus({ preventScroll: true });
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready) void go(text);
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text');
    if (!pasted.trim() || busy) return;
    // A one-line field would run a message's lines together: the text is read as it was copied.
    event.preventDefault();
    const field = event.currentTarget;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? field.value.length;
    void go(field.value.slice(0, start) + pasted + field.value.slice(end));
  }

  async function paste() {
    let pasted = '';
    let failure: 'door.paste.empty' | 'door.paste.blocked.touch' | 'door.paste.blocked.keys' | null = null;
    try {
      pasted = await navigator.clipboard.readText();
      if (!pasted.trim()) failure = 'door.paste.empty';
    } catch {
      failure = touchScreen() ? 'door.paste.blocked.touch' : 'door.paste.blocked.keys';
    }
    if (failure) {
      // The field takes the focus, ready for a paste by hand.
      setNote(t(failure));
      input.current?.focus({ preventScroll: true });
      return;
    }
    trackAction('parcel-paste', 'success');
    void go(pasted);
  }

  const written = Boolean(text.trim());
  const canPaste = !ready || (typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function');
  const noteId = `${id}-note`;

  return <form ref={form} className="deliveries-field" noValidate onSubmit={submit}
    // A note is about what was just tried: it goes once the focus moves on.
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setNote(null); }}>
    <label htmlFor={id} className="sr-only">{t('field.label')}</label>
    <div className="deliveries-field__box">
      <input ref={input} id={id} type="text" value={busy ? busy.shown : text} placeholder={t('add.trackingPlaceholder')}
        readOnly={Boolean(busy)} data-number={busy || looksLikeNumber(text) ? '' : undefined}
        autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="go"
        aria-describedby={note && !busy ? noteId : undefined}
        onChange={(event) => { setText(event.target.value); setNote(null); }}
        onKeyDown={(event) => { if (event.key === 'Escape' && note) setNote(null); }}
        onPaste={onPaste} />
      {/* Until the page is live Enter must not send the form anywhere: a disabled submit button holds it. */}
      {!ready && <button type="submit" disabled hidden />}
      {written || busy
        ? <button type="submit" className="deliveries-field__track" disabled={!ready || Boolean(busy)}>{t('peek.track')}</button>
        : canPaste && <button ref={pasteButton} type="button" className="deliveries-field__paste" disabled={!ready} onClick={() => void paste()}><DoorIcon name="clipboard" />{t('add.paste')}</button>}
    </div>
    {/* What the field says back floats under it, so nothing below moves. It is read out politely, and stands
        apart from the toasts' own status. */}
    <div className="deliveries-field__feedback" aria-live="polite" aria-atomic="true">
      {busy?.step === 'asking' && <p className="deliveries-field__line" data-busy="">
        <Icon name="detect" />
        <span>
          <strong>{t('door.line.finding')}</strong>
          {busy.carriers.length > 0 && <> <small>{t('add.line.asking', { carriers: carrierNameList(busy.carriers.slice(0, ASKED_NAMED), locale, languageTag) })}</small></>}
        </span>
      </p>}
      {busy?.step === 'adding' && <p className="deliveries-field__line" data-busy=""><Icon name="detect" /><span><strong>{t('add.adding')}</strong></span></p>}
      {!busy && note && <p id={noteId} className="deliveries-field__line deliveries-field__line--note">{note}</p>}
    </div>
  </form>;
}
