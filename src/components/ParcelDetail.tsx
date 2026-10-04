import { AMAZON_HISTORY_EXPIRED } from '../lib/amazon';
import { AutoCarrierNotice } from './AutoCarrierNotice';
import { trackAction } from '../lib/analytics';
import { userErrorMessage } from '../lib/userMessages';
import { useEffect, useMemo, useState, useRef, type FormEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  activeTrackingCarrierId,
  displayedCarrierId,
  carrierInfo,
  carrierRequirements,
  carrierTrackingHintKey,
  formatTrackingNumber,
  parcelTrackingLinks,
  parcelTrackingNumbers,
  tracksAutomatically,
} from '../lib/carriers';
import {
  localizedDeliveryWindow,
  trackingFailureMessage,
  localizedDatePhrase,
  localizedRelativeTime,
  useI18n,
} from '../i18n';
import {
  localizedParcelCompletionDate,
  parcelDeliveryEstimate,
  parcelDisplayStatus,
  parcelDisplayStatusKey,
  parcelHasCarrierUpdate,
} from '../lib/parcelStatus';
import { currentEvent } from '../lib/stages';
import { isBackSwipe, type TouchPoint } from '../lib/swipe';
import { useCardDialog } from '../lib/cardDialog';
import { RefreshTimeoutError, type CarrierId, type ParcelCarrierInput, type ParcelWithEvents } from '../types';
import { ChangeCarrierSheet } from './ChangeCarrierSheet';
import { TrackingJournal } from './TrackingJournal';
import { CarrierMark } from './CarrierMark';
import { carrierBrand } from '../lib/carrierBrand';
import './ParcelDetail.css';
import { Icon } from './Icon';
import { ParcelStamp } from './ParcelStamp';
import { parcelTone } from '../lib/parcelDesign';
import { ParcelMapSheet, RouteEngraving, useParcelRoute } from './ParcelMap';
import { ProgressTrack } from './ProgressTrack';
import { PickupPointCard } from './PickupPointCard';
import { pickupPoint } from '../lib/pickupPoint';
import type { CardOrigin } from '../lib/cardTransition';
import { useRefreshAnimation } from '../lib/useRefreshAnimation';
import type { ApiAuth } from '../lib/apiClient';
import { createAccountShare, demoAccountShare } from '../peek/links';
import { AccountShareSheet } from '../peek/parcel/ShareSheet';
import { useDeliveryEmail, useNotificationPreferences } from '../store/notificationPreferences';
import { EmailOffer } from './EmailOffer';
import { presetTitleKey } from './NotificationControl';
import { ParcelAlertsSheet } from './ParcelAlertsSheet';
import './Refresh.css';

export function ParcelDetail({
  parcel,
  onBack: onDismissed,
  onRename,
  onChangeCarrier,
  onSetNotificationsMuted,
  onSetEmailMuted,
  onRefresh,
  onRestore,
  onArchive,
  onDelete,
  onExitDemo,
  openingOrigin,
  usedCarriers,
  apiAuth,
  accountEmail,
}: {
  parcel: ParcelWithEvents;
  /** The signed-in account, which can share the parcel through a link. Without one, only a build without an API can: its links stay in the browser. */
  apiAuth?: ApiAuth;
  /** The address the account signs in with, where its delivery email goes. */
  accountEmail?: string;
  /** The carriers of the latest parcels, offered first when changing the carrier. */
  usedCarriers?: readonly CarrierId[];
  openingOrigin?: CardOrigin | null;
  onExitDemo?: () => void;
  onBack: () => void;
  onRename: (parcel: ParcelWithEvents, label: string) => Promise<unknown>;
  onChangeCarrier: (
    parcel: ParcelWithEvents,
    input: ParcelCarrierInput,
  ) => Promise<unknown>;
  onSetNotificationsMuted: (
    parcel: ParcelWithEvents,
    muted: boolean,
  ) => Promise<unknown>;
  /** Turns the delivery email off or back on for this parcel; only an account has it. */
  onSetEmailMuted?: (
    parcel: ParcelWithEvents,
    muted: boolean,
  ) => Promise<unknown>;
  /** Resolves true when the check brought new tracking. */
  onRefresh: (parcel: ParcelWithEvents) => Promise<boolean>;
  onRestore: (parcel: ParcelWithEvents) => Promise<unknown>;
  onArchive: (parcel: ParcelWithEvents) => Promise<unknown>;
  onDelete: (parcel: ParcelWithEvents) => Promise<unknown>;
}) {
  const { locale, languageTag, t } = useI18n();
  const carrier = carrierInfo(activeTrackingCarrierId(parcel), locale);
  const displayedCarrier = carrierInfo(displayedCarrierId(parcel), locale);
  const amazonHistoryExpired = carrier.id === 'amazon-shipping' && parcel.syncError === AMAZON_HISTORY_EXPIRED;
  const automaticTracking = tracksAutomatically(carrier.id) && !amazonHistoryExpired;
  const current = currentEvent(parcel.events);
  // While the parcel waits, its pickup point gets a card; afterwards it is a plain fact.
  const waitingAt = current?.stage === 'ready_for_pickup' ? pickupPoint(parcel.pickupPoint) : null;
  const pickupFact = waitingAt ? undefined : parcel.pickupPoint?.trim();
  const { placed, route } = useParcelRoute(parcel, languageTag);
  const [mapOpen, setMapOpen] = useState(false);
  // Recognition found the carrier, but it needs the postcode before it can track.
  const inputNeeded = parcel.inputNeeded?.field === 'dpdPostcode' && parcel.inputNeeded.carrier !== parcel.carrier
    && !parcel.archivedAt && !['delivered', 'returned'].includes(current?.stage ?? '') ? parcel.inputNeeded : undefined;
  const status = parcelDisplayStatus(parcel);
  const statusLabel = t(parcelDisplayStatusKey(parcel));
  const completionDate = localizedParcelCompletionDate(parcel, languageTag, t);
  const estimate = parcelDeliveryEstimate(parcel);
  const trackingLinks = parcelTrackingLinks(parcel, locale);
  const trackingNumbers = parcelTrackingNumbers(parcel);
  const lastChecked = parcel.lastSyncedAt
    ? localizedRelativeTime(parcel.lastSyncedAt, t, languageTag)
    : null;
  const lastUpdate = current && current.stage !== 'pending'
    ? localizedRelativeTime(current.occurredAt, t, languageTag)
    : null;
  const swipeStart = useRef<TouchPoint | null>(null);
  const backdropPress = useRef(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingCarrier, setEditingCarrier] = useState(false);
  // The carrier sheet opens on a recognized carrier when the prompt below asks for its input.
  const [carrierSheetInitial, setCarrierSheetInitial] = useState<CarrierId>();
  const [title, setTitle] = useState(parcel.label);
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const { icon: refreshIcon, busy: refreshAnimating, run: animateRefresh } = useRefreshAnimation();
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkNotice, setCheckNotice] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedNumber, setCopiedNumber] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [notificationsAnimated, setNotificationsAnimated] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const delivered = current?.stage === 'delivered';
  // While the account's delivery email is on, a parcel still on its way has two alerts: the bell opens them.
  const preferences = useNotificationPreferences(apiAuth);
  const deliveryEmail = useDeliveryEmail(apiAuth, accountEmail);
  const twoAlerts = deliveryEmail?.choice === true && !!onSetEmailMuted && !delivered && current?.stage !== 'returned';
  const [alertsOpen, setAlertsOpen] = useState(false);
  const shareClient = useMemo(() => apiAuth ? createAccountShare(apiAuth) : demoAccountShare, [apiAuth]);
  const canShare = !!shareClient && !parcel.archivedAt;
  const [sharing, setSharing] = useState(false);
  const backButton = useRef<HTMLButtonElement>(null);
  const actionsMenu = useRef<HTMLDetailsElement>(null);
  const header = useRef<HTMLElement>(null);
  const hero = useRef<HTMLElement>(null);
  // The page opens out of its card and goes back into it: the hero is the card's counterpart.
  const [dialog, onBack] = useCardDialog<HTMLDivElement>(onDismissed, backButton, {
    origin: openingOrigin,
    findCard: () => document.querySelector<HTMLElement>(`.parcel-card-swipe[data-parcel-id="${CSS.escape(parcel.id)}"] .parcel-card`),
    anchor: () => hero.current,
    header: () => header.current,
    canPull: () => !editingCarrier && !confirmingDelete,
  });

  function openMap() {
    if (!route) return;
    trackAction('parcel-map-open');
    setMapOpen(true);
  }

  function beginTitleEdit() {
    setTitle(parcel.label);
    setTitleError(null);
    setEditingTitle(true);
  }

  function cancelTitleEdit() {
    setEditingTitle(false);
    setTitleError(null);
  }

  async function handleTitleSubmit(event: FormEvent) {
    event.preventDefault();
    if (savingTitle) return;
    const nextTitle = title.trim();
    if (nextTitle === parcel.label) {
      cancelTitleEdit();
      return;
    }
    setSavingTitle(true);
    setTitleError(null);
    try {
      await onRename(parcel, nextTitle);
      setEditingTitle(false);
    } catch (error) {
      setTitleError(userErrorMessage(error, t, 'detail.renameFailed'));
    } finally {
      setSavingTitle(false);
    }
  }

  async function checkNow() {
    if (checking) return;
    setChecking(true);
    setCheckError(null);
    setCheckNotice(t('app.refreshing'));
    try {
      setCheckNotice(t(await onRefresh(parcel) ? 'app.refreshComplete' : 'app.refreshUnchanged'));
    } catch (error) {
      const stillChecking = error instanceof RefreshTimeoutError;
      setCheckNotice(stillChecking ? t('app.refreshTimeout') : null);
      if (!stillChecking) setCheckError(userErrorMessage(error, t, 'detail.checkFailed'));
    } finally {
      setChecking(false);
    }
  }

  async function restoreNow() {
    if (restoring) return;
    setRestoring(true);
    setCheckError(null);
    try {
      await onRestore(parcel);
    } catch (error) {
      setCheckError(userErrorMessage(error, t, 'detail.restoreFailed'));
      setRestoring(false);
    }
  }

  async function archiveNow() {
    if (archiving) return;
    setArchiving(true);
    setCheckError(null);
    try {
      await onArchive(parcel);
    } catch (error) {
      setCheckError(userErrorMessage(error, t, 'detail.archiveFailed'));
      setArchiving(false);
    }
  }

  async function deleteNow() {
    if (deleting) return;
    setDeleting(true);
    setCheckError(null);
    try {
      await onDelete(parcel);
    } catch (error) {
      setCheckError(userErrorMessage(error, t, 'detail.deleteFailed'));
      setDeleting(false);
    }
  }

  async function copyTrackingNumber(number: string, numberCarrier: CarrierId) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(numberCarrier === 'postlogistics'
        ? formatTrackingNumber(number, numberCarrier) : number);
      trackAction('parcel-copy-tracking', 'success');
      setCopiedNumber(number);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }
  }

  async function toggleNotifications() {
    if (savingNotifications) return;
    setSavingNotifications(true);
    setNotificationError(null);
    try {
      await onSetNotificationsMuted(parcel, !parcel.notificationsMuted);
      setNotificationsAnimated(true);
    } catch (error) {
      setNotificationError(
        userErrorMessage(error, t, 'detail.notificationFailed'),
      );
    } finally {
      setSavingNotifications(false);
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.isPrimary === false) {
      swipeStart.current = null;
      return;
    }
    const detailBounds = event.currentTarget.getBoundingClientRect();
    swipeStart.current = {
      x: event.clientX - detailBounds.left,
      y: event.clientY,
    };
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (confirmingDelete) return;
    const detailBounds = event.currentTarget.getBoundingClientRect();
    if (start && isBackSwipe(start, {
      x: event.clientX - detailBounds.left,
      y: event.clientY,
    })) {
      onBack();
    }
  }

  const trackingSources = trackingLinks.length > 0 && (
    <div className={`detail__carrier-links${trackingLinks.length > 1 ? ' detail__carrier-links--journey' : ''}`} aria-label={t('detail.trackingSources')}>
      {trackingLinks.map((link) => {
        const role = link.role === 'active' ? t('detail.sourceActive')
          : link.role === 'waiting' ? t('detail.sourceWaiting') : t('detail.sourceHistory');
        const website = t('detail.carrierWebsite', { carrier: link.name });
        return <a
          key={`${link.role}:${link.url}`}
          className={`detail__carrier-link detail__carrier-link--${link.role}`}
          aria-label={link.role === 'active' ? website : `${website} — ${role}`}
          href={link.url} onClick={() => trackAction('parcel-carrier-link')}
          target="_blank" rel="noopener noreferrer"
        >
          <span>{trackingLinks.length > 1 ? link.name : website}</span>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 18 18 6M6 6h12v12" /></svg>
          {(trackingLinks.length > 1 || link.role !== 'active') && <small>{role}</small>}
        </a>;
      })}
    </div>
  );

  return createPortal(
    <div
      className="sheet-backdrop detail-backdrop"
      onPointerDown={(event) => {
        backdropPress.current = event.target === event.currentTarget && event.button === 0 && event.isPrimary !== false;
      }}
      onPointerUp={(event) => {
        if (event.target !== event.currentTarget) backdropPress.current = false;
      }}
      onPointerCancel={() => { backdropPress.current = false; }}
      onClick={(event) => {
        const outside = backdropPress.current && event.target === event.currentTarget;
        backdropPress.current = false;
        if (outside && !editingCarrier && !confirmingDelete && !dialog.current?.hasAttribute('inert')) onBack();
      }}
    >
    <div
      ref={dialog}
      style={carrierBrand(displayedCarrier).style}
      className={`detail detail--postcard tone-${parcelTone(current?.stage)}${openingOrigin ? ' detail--from-card' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={parcel.label || t('common.parcel')}
      tabIndex={-1}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { swipeStart.current = null; }}
    >
      <header ref={header} className="detail__header">
        <button ref={backButton} type="button" className="detail__back" onClick={onBack}>
          <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m13 4-6 6 6 6" /></svg>
          {t('detail.back')}
        </button>
        <span>{t('detail.label')}</span>
        <details className="detail__actions-menu" ref={actionsMenu}>
          <summary aria-label={t('detail.parcelActions')}>
            <span aria-hidden="true">•••</span>
          </summary>
          <div>
            <button type="button" onClick={() => {
              if (actionsMenu.current) actionsMenu.current.open = false;
              beginTitleEdit();
            }}>{t('detail.editTitle')}</button>
            {canShare && <button type="button" onClick={() => {
              if (actionsMenu.current) actionsMenu.current.open = false;
              setSharing(true);
            }}>{t('link.share')}</button>}
            <button
              type="button"
              disabled={deleting}
              onClick={() => {
                if (actionsMenu.current) actionsMenu.current.open = false;
                setEditingCarrier(true);
              }}
            >
              {t('detail.changeCarrier')}
            </button>
            {!parcel.archivedAt && (
              <button
                type="button"
                disabled={archiving || deleting}
                onClick={() => {
                  if (actionsMenu.current) actionsMenu.current.open = false;
                  void archiveNow();
                }}
              >
                {archiving ? t('detail.archiving') : t('detail.archive')}
              </button>
            )}
            {!parcel.archivedAt && (
              <button
                type="button"
                className="detail__actions-menu-danger"
                disabled={archiving || deleting}
                onClick={() => {
                  if (actionsMenu.current) actionsMenu.current.open = false;
                  setCheckError(null);
                  setConfirmingDelete(true);
                }}
              >
                {t('detail.delete')}
              </button>
            )}
          </div>
        </details>
      </header>

      {onExitDemo && <div className="demo-banner demo-banner--detail"><span>{t('app.demo')}</span><button type="button" onClick={onExitDemo}>{t('native.exitDemo')}<Icon name="close" /></button></div>}
      <section ref={hero} className={`detail__hero${placed ? ' detail__hero--map' : ''}`}>
        {placed && <RouteEngraving route={route} stage={current?.stage} onOpen={openMap} />}
        <div className="detail__hero-meta">
          <button
            type="button"
            className="detail__carrier detail__carrier--editable"
            onClick={() => setEditingCarrier(true)}
            aria-label={t('detail.changeCarrierFrom', { carrier: carrier.name })}
          >
            <CarrierMark carrier={displayedCarrier} />
          </button>
          <span className="detail__hero-actions">
          {placed && <button type="button" className="detail__map-button" disabled={!route} onClick={openMap} aria-label={t('map.open')}>
            <Icon name="globe" />
          </button>}
          {canShare && <button type="button" className="detail__share-button" onClick={() => setSharing(true)} aria-label={t('link.shareAria')}>
            <Icon name="share" />
          </button>}
          <button type="button" className="detail__notification" disabled={savingNotifications}
            data-animated={notificationsAnimated || undefined}
            {...(twoAlerts ? {
              // The bell reads as off only when both alerts are off for this parcel.
              'aria-label': t('email.parcel.open'), 'aria-haspopup': 'dialog',
              'data-muted': (parcel.notificationsMuted && parcel.emailMuted) || undefined,
              onClick: () => setAlertsOpen(true),
            } : {
              'aria-label': parcel.notificationsMuted ? t('detail.unmute') : t('detail.mute'),
              'aria-pressed': !!parcel.notificationsMuted, onClick: () => void toggleNotifications(),
            })}>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <g className="parcel-bell__body">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                <path className="parcel-bell__clapper" d="M10 21h4" />
              </g>
              <path className="parcel-bell__slash" pathLength="1" d="m3 3 18 18" />
              <g className="parcel-bell__waves"><path d="M1 6a10 10 0 0 0 0 8M23 6a10 10 0 0 1 0 8" /></g>
            </svg>
          </button>
          </span>
        </div>
        <AutoCarrierNotice parcel={parcel} className="detail__sender" />
        {inputNeeded && (
          <div className="detail__input-needed" role="status">
            <p>{t('detail.inputNeeded', { carrier: carrierInfo(inputNeeded.carrier, locale).name })}</p>
            <button type="button" className="text-button" onClick={() => {
              setCarrierSheetInitial(inputNeeded.carrier);
              setEditingCarrier(true);
            }}>{t('detail.inputNeededAction')}</button>
          </div>
        )}
        {editingTitle ? (
          <form className="detail__title-form" onSubmit={handleTitleSubmit}>
            <input
              className="detail__title-input"
              type="text"
              aria-label={t('detail.titleAria')}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('common.parcel')}
              maxLength={80}
              autoFocus
            />
            {titleError && (
              <p className="detail__title-error" role="alert">{titleError}</p>
            )}
            <div className="detail__title-actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={cancelTitleEdit}
                disabled={savingTitle}
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="button button--primary"
                disabled={savingTitle}
              >
                {savingTitle ? t('detail.saving') : t('detail.saveTitle')}
              </button>
            </div>
          </form>
        ) : (
          <div className="detail__title-row">
            <h1 className="detail__title">{parcel.label || t('common.parcel')}</h1>
            <ParcelStamp parcel={parcel} />
          </div>
        )}
        {parcel.senderName?.trim() && <p className="detail__sender">{t('parcel.sender', { sender: parcel.senderName.trim() })}</p>}
        {parcel.carrier === 'dpd' && parcel.dpdPostcode && parcel.dpdPostcodeVerified === false && (
          <p className="detail__postcode-note">
            {t('detail.postcodeNotVerified', { carrier: carrier.name, postcode: parcel.dpdPostcode })}{' '}
            {!parcel.archivedAt && (
              <button type="button" className="detail__postcode-edit" onClick={() => setEditingCarrier(true)}>
                {t('detail.editPostcode')}
              </button>
            )}
          </p>
        )}
        {trackingLinks.length > 1 && trackingSources}
        <p className="detail__state">{statusLabel}</p>
        {(completionDate || estimate) && (
          <p className="detail__arrival">
            {completionDate
              ? localizedDatePhrase(completionDate, t)
              : localizedDeliveryWindow(parcel.expectedDeliveryFrom, estimate!, t, languageTag)}
          </p>
        )}
        <div className="detail__progress"><ProgressTrack stage={current?.stage ?? null} /></div>
      </section>
      {waitingAt && <PickupPointCard point={waitingAt} />}
      {delivered && apiAuth && accountEmail && <EmailOffer apiAuth={apiAuth} email={accountEmail} />}
      <section className="detail__information">
        {(pickupFact || parcel.receiverName || parcel.dimensionsText || (Number.isFinite(parcel.weightKg) && parcel.weightKg! > 0)) && (
          <dl className="detail__shipment-facts">
            {pickupFact && <div><dt>{t(current?.stage === 'delivered' ? 'detail.collectedAt' : 'detail.pickupPoint')}</dt><dd>{pickupFact}</dd></div>}
            {parcel.receiverName && <div><dt>{t('detail.recipient')}</dt><dd>{parcel.receiverName}</dd></div>}
            {Number.isFinite(parcel.weightKg) && parcel.weightKg! > 0 && <div><dt>{t('detail.weight')}</dt><dd>{new Intl.NumberFormat(languageTag, { style: 'unit', unit: 'kilogram', maximumFractionDigits: 3 }).format(parcel.weightKg!)}</dd></div>}
            {parcel.dimensionsText && <div><dt>{t('detail.dimensions')}</dt><dd>{parcel.dimensionsText}</dd></div>}
          </dl>
        )}
        <div className="detail__shipment">
          {trackingNumbers.map(({ carrier: numberCarrier, number }) => <div className="detail__tracking-ticket" key={number}>
            <span className="detail__tracking-label">{trackingNumbers.length > 1 ? carrierInfo(numberCarrier, locale).name : t('detail.trackingNumber')}</span>
            <strong>{formatTrackingNumber(number, numberCarrier)}</strong>
            <button
              type="button"
              className="detail__tracking-copy"
              onClick={() => void copyTrackingNumber(number, numberCarrier)}
              aria-label={trackingNumbers.length > 1 ? `${t('detail.copyTracking')} — ${carrierInfo(numberCarrier, locale).name}` : t('detail.copyTracking')}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d={copyStatus === 'copied' && copiedNumber === number ? 'm5 12 4 4L19 6' : 'M9 9h11v12H9V9ZM5 15H3V3h12v2'} /></svg>
              <span className="sr-only" aria-live="polite">{copyStatus === 'copied' && copiedNumber === number ? t('detail.copied') : ''}</span>
            </button>
          </div>)}
          {trackingLinks.length <= 1 && trackingSources}
        </div>
        {copyStatus === 'error' && (
          <p className="detail__copy-error" role="alert">
            {t('detail.copyUnavailable')}
          </p>
        )}
        {!automaticTracking && (
          <div className="detail__tracking-help" role="note">
            <p>{t(amazonHistoryExpired ? 'add.amazonHistoryExpired' : carrierTrackingHintKey(carrier.id), { carrier: carrier.name })}</p>
            {carrier.id !== 'amazon-logistics' && !amazonHistoryExpired && (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setEditingCarrier(true)}
              >
                {t('detail.changeCarrier')}
              </button>
            )}
          </div>
        )}
        {automaticTracking && parcel.syncError && (
          <div className="detail__sync-error" role="status">
            <p>{trackingFailureMessage(parcel.syncError, t)}</p>
            {parcel.syncError === 'carrier:input_required' && carrier.id === parcel.carrier && carrierRequirements(parcel.carrier, parcel.trackingNumber).length > 0 && (
              <button type="button" className="button button--secondary" onClick={() => setEditingCarrier(true)}>{t('detail.updateTrackingDetails')}</button>
            )}
          </div>
        )}

        {checkError && <p className="detail__check-error" role="alert">{checkError}</p>}
        {checkNotice && <p className="detail__check-notice" role="status">{checkNotice}</p>}
        {notificationError && (
          <p className="detail__check-error" role="alert">{notificationError}</p>
        )}
      </section>

      {(automaticTracking || parcelHasCarrierUpdate(parcel)) && (
        <section className="detail__timeline">
          <TrackingJournal events={parcel.events} syncing={status.syncing} />
        </section>
      )}

      <div className="detail__sync">
        <div className="detail__freshness">
          <div className="detail__freshness-times">
            {lastChecked && <span>{t('detail.lastChecked', { date: lastChecked })}</span>}
            {lastUpdate && <span>{t('detail.lastUpdate', { date: lastUpdate })}</span>}
          </div>
          {!parcel.archivedAt && automaticTracking && (
            <button
              type="button"
              className="detail__refresh"
              onClick={() => void animateRefresh(checkNow)}
              disabled={checking || refreshAnimating}
              aria-busy={checking || refreshAnimating}
              data-refreshing={refreshAnimating || undefined}
              aria-label={checking ? t('app.refreshing') : t('detail.checkNow')}
            >
              <span ref={refreshIcon} className="refresh-glyph"><Icon name="refresh" /></span>
            </button>
          )}
        </div>
      </div>

      {parcel.archivedAt && (
        <footer className="detail__footer detail__footer--archived">
          <button
            type="button"
            className="detail__restore"
            onClick={() => void restoreNow()}
            disabled={restoring}
          >
            {restoring ? t('common.restoring') : t('detail.restore')}
          </button>
          <button
            type="button"
            className="detail__delete"
            onClick={() => {
              setCheckError(null);
              setConfirmingDelete(true);
            }}
            disabled={restoring || deleting}
          >
            {t('detail.delete')}
          </button>
        </footer>
      )}

      {editingCarrier && (
        <ChangeCarrierSheet
          parcel={parcel}
          initialCarrier={carrierSheetInitial}
          usedCarriers={usedCarriers}
          onChange={(input) => onChangeCarrier(parcel, input)}
          onClose={() => { setEditingCarrier(false); setCarrierSheetInitial(undefined); }}
        />
      )}

      {confirmingDelete && (
        <DeleteParcelDialog
          parcelName={parcel.label || t('common.parcel').toLocaleLowerCase(languageTag)}
          deleting={deleting}
          error={checkError}
          onCancel={() => {
            setConfirmingDelete(false);
            setCheckError(null);
          }}
          onDelete={() => void deleteNow()}
        />
      )}

      {mapOpen && route && (
        <ParcelMapSheet route={route} stage={current?.stage} brand={carrierBrand(displayedCarrier).style} onClose={() => setMapOpen(false)} />
      )}

      {sharing && shareClient && <AccountShareSheet parcel={parcel} client={shareClient} onClose={() => setSharing(false)} />}

      {alertsOpen && deliveryEmail && preferences && onSetEmailMuted && <ParcelAlertsSheet
        parcel={parcel}
        email={deliveryEmail.address}
        preset={t(presetTitleKey(preferences.enabledStages))}
        onSetNotificationsMuted={(muted) => onSetNotificationsMuted(parcel, muted)}
        onSetEmailMuted={(muted) => onSetEmailMuted(parcel, muted)}
        onClose={() => setAlertsOpen(false)}
      />}
    </div>
    </div>,
    document.body,
  );
}

function DeleteParcelDialog({
  parcelName,
  deleting,
  error,
  onCancel,
  onDelete,
}: {
  parcelName: string;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    return () => {
      if (typeof element.close === 'function' && element.open) element.close();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="delete-parcel-dialog"
      aria-labelledby="delete-parcel-title"
      aria-describedby="delete-parcel-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!deleting) onCancel();
      }}
    >
      <p className="sheet__eyebrow">{t('detail.parcelActions')}</p>
      <h2 id="delete-parcel-title">
        {t('detail.deleteQuestionAria', { name: parcelName })}
      </h2>
      <p id="delete-parcel-description">{t('detail.deleteDescription')}</p>
      {error && <p className="sheet__error" role="alert">{error}</p>}
      <div className="delete-parcel-dialog__actions">
        <button
          type="button"
          className="button button--secondary"
          onClick={onCancel}
          disabled={deleting}
          autoFocus
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="button button--danger"
          onClick={onDelete}
          disabled={deleting}
        >
          {deleting ? t('detail.deleting') : t('detail.delete')}
        </button>
      </div>
    </dialog>
  );
}
