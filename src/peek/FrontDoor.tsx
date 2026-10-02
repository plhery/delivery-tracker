import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type MouseEvent } from 'react';
import { ParcelIllustration } from '../components/Icon';
import { PeekLockup } from '../components/PeekMark';
import { useI18n, type MessageKey } from '../i18n';
import { carrierInfo, displayedCarrierId, formatTrackingNumber, normalizeTrackingNumber, parseTrackingInput } from '../lib/carriers';
import { parcelDisplayStatusKey } from '../lib/parcelStatus';
import type { CarrierId } from '../types';
import { lookupParcel, maskedNumber, parcelLinkErrorKey, type ParcelLinkView } from './links';
import { useRecents, type RecentParcel } from './recents';
import { openParcelLink, parcelLinkPath, PIP_TRANSITION_NAME } from './route';
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
 * The front door: one field that takes a number, a link or a pasted message,
 * and the parcels this device already looked up.
 */
export function FrontDoor({ onTracked, onSignIn }: {
  onTracked: (tracked: TrackedParcel) => void;
  onSignIn: () => void;
}) {
  const { t } = useI18n();
  const recents = useRecents();
  // The buttons wait for the page to be live; what was typed into the field before that stays.
  const ready = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const field = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function track(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const found = parseTrackingInput(field.current?.value ?? '');
    if (!found.trackingNumber) {
      setError('add.notFound');
      return;
    }
    const controller = request.current = new AbortController();
    setBusy(true);
    setError(null);
    try {
      const { id, key, view } = await lookupParcel({
        trackingNumber: normalizeTrackingNumber(found.trackingNumber),
        ...(found.carrier !== 'unknown' ? { carrier: found.carrier } : {}),
        ...(found.trackingUrl ? { trackingUrl: found.trackingUrl } : {}),
      }, controller.signal);
      if (!controller.signal.aborted) onTracked({ id, key, carrier: view.parcel.carrier, response: view });
    } catch (reason) {
      if (!controller.signal.aborted) setError(parcelLinkErrorKey(reason));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <main className="door">
    <header className="door-header">
      <PeekLockup />
      <button type="button" className="door-signin" disabled={!ready} onClick={onSignIn}>{t('arrival.signInTitle')}</button>
    </header>
    <div className="door-scene">
      <div className="door-pip" style={{ viewTransitionName: PIP_TRANSITION_NAME }}><ParcelIllustration /></div>
      <h1>{t('peek.title')}</h1>
      <form className="door-lookup" onSubmit={(event) => void track(event)}>
        <label htmlFor="door-tracking" className="sr-only">{t('add.tracking')}</label>
        <input ref={field} id="door-tracking" placeholder={t('add.trackingPlaceholder')} autoComplete="off" autoCapitalize="characters" spellCheck={false}
          aria-describedby={error ? 'door-error' : undefined} aria-invalid={error ? true : undefined}
          onInput={() => setError(null)} />
        <button type="submit" className="button button--primary" disabled={!ready || busy}>{t('peek.track')}</button>
      </form>
      {error && <p id="door-error" className="door-error" role="alert">{t(error)}</p>}
      {recents.length > 0 && <section className="door-recents" aria-labelledby="door-recents-title">
        <h2 id="door-recents-title">{t('peek.onThisDevice')}</h2>
        <ul>{recents.map((recent) => <li key={recent.id}><RecentLink recent={recent} /></li>)}</ul>
      </section>}
    </div>
  </main>;
}

function RecentLink({ recent }: { recent: RecentParcel }) {
  const { t, locale } = useI18n();
  const { parcel, numberHint } = recent.snapshot;
  const carrier = carrierInfo(displayedCarrierId(parcel), locale);
  const number = parcel.trackingNumber ? formatTrackingNumber(parcel.trackingNumber, parcel.carrier)
    : numberHint ? maskedNumber(numberHint) : t('common.parcel');
  function open(event: MouseEvent) {
    // A modified click opens the link the browser's way, in a new tab or window.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    openParcelLink(recent.id);
  }
  return <a href={parcelLinkPath(recent.id)} onClick={open}>
    <strong>{recent.name ?? number}</strong>
    <span>{carrier.name} · {t(parcelDisplayStatusKey(parcel))}</span>
  </a>;
}
