import { AMAZON_HISTORY_EXPIRED } from '../lib/amazon';
import { AutoCarrierNotice } from './AutoCarrierNotice';
import { trackAction } from '../lib/analytics';
import { userErrorMessage } from '../lib/userMessages';
import { useEffect, useState, useRef, type FormEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  activeTrackingCarrierId,
  displayedCarrierId,
  carrierInfo,
  carrierTrackingHintKey,
  formatTrackingNumber,
  parcelTrackingLinks,
  parcelTrackingNumbers,
  tracksAutomatically,
} from '../lib/carriers';
import {
  localizedExpectedDelivery,
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
import { useSheetDialog } from '../lib/modal';
import type { ParcelCarrierInput, ParcelWithEvents, SyncProgress } from '../types';
import { ChangeCarrierSheet } from './ChangeCarrierSheet';
import { TrackingJournal } from './TrackingJournal';
import { CarrierMark } from './CarrierMark';
import { carrierBrand } from '../lib/carrierBrand';
import './ParcelDetail.css';
import { Icon, PostageStamp } from './Icon';
import { parcelIcon, parcelTone } from '../lib/parcelDesign';
import { ProgressTrack } from './ProgressTrack';
import type { CardOrigin } from '../lib/cardTransition';

export function ParcelDetail({
  parcel,
  onBack: onDismissed,
  onRename,
  onChangeCarrier,
  onSetNotificationsMuted,
  onRefresh,
  onRestore,
  onArchive,
  onDelete,
  onExitDemo,
  openingOrigin,
}: {
  parcel: ParcelWithEvents;
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
  onRefresh: (parcel: ParcelWithEvents, onProgress?: (progress: SyncProgress) => void) => Promise<unknown>;
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
  const [title, setTitle] = useState(parcel.label);
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkNotice, setCheckNotice] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedNumber, setCopiedNumber] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const actionsMenu = useRef<HTMLDetailsElement>(null);
  const [dialog, onBack] = useSheetDialog<HTMLDivElement>(true, onDismissed, backButton, openingOrigin);

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
    setCheckNotice(null);
    try {
      await onRefresh(parcel, (progress) => setCheckNotice(t(`sync.${progress}`)));
      setCheckNotice(t('sync.completed'));
    } catch (error) {
      setCheckNotice(null);
      setCheckError(userErrorMessage(error, t, 'detail.checkFailed'));
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

  async function copyTrackingNumber(number: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(number);
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
      <header className="detail__header">
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
      <section className="detail__hero">
        <div className="detail__hero-meta">
          <button
            type="button"
            className="detail__carrier detail__carrier--editable"
            onClick={() => setEditingCarrier(true)}
            aria-label={t('detail.changeCarrierFrom', { carrier: carrier.name })}
          >
            <CarrierMark carrier={displayedCarrier} />
          </button>
          <button type="button" className="detail__notification" disabled={savingNotifications}
            aria-label={parcel.notificationsMuted ? t('detail.unmute') : t('detail.mute')}
            aria-pressed={!!parcel.notificationsMuted} onClick={() => void toggleNotifications()}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />{parcel.notificationsMuted && <path d="m3 3 18 18" />}</svg>
          </button>
        </div>
        <AutoCarrierNotice parcel={parcel} className="detail__sender" />
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
            <PostageStamp icon={parcelIcon(current?.stage)} />
          </div>
        )}
        {parcel.senderName?.trim() && <p className="detail__sender">{t('parcel.sender', { sender: parcel.senderName.trim() })}</p>}
        {trackingLinks.length > 1 && trackingSources}
        <p className="detail__state">{statusLabel}</p>
        {(completionDate || estimate) && (
          <p className="detail__arrival">
            {completionDate
              ? localizedDatePhrase(completionDate, t)
              : localizedExpectedDelivery(estimate!, t, languageTag)}
          </p>
        )}
        <div className="detail__progress"><ProgressTrack stage={current?.stage ?? null} /></div>
      </section>
      <section className="detail__information">
        <div className="detail__shipment">
          {trackingNumbers.map(({ carrier: numberCarrier, number }) => <div className="detail__tracking-ticket" key={number}>
            <span className="detail__tracking-label">{trackingNumbers.length > 1 ? carrierInfo(numberCarrier, locale).name : t('detail.trackingNumber')}</span>
            <strong>{formatTrackingNumber(number)}</strong>
            <button
              type="button"
              className="detail__tracking-copy"
              onClick={() => void copyTrackingNumber(number)}
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
          <p className="detail__sync-error" role="status">{t('detail.trackingUnavailable')}</p>
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
              onClick={() => void checkNow()}
              disabled={checking}
              aria-label={checking ? checkNotice ?? t('detail.queueing') : t('detail.checkNow')}
            >
              <svg className={checking ? 'spin' : undefined} aria-hidden="true" viewBox="0 0 24 24">
                <path d="M19 8a7.5 7.5 0 1 0 .2 7.6M19 4v4h-4" />
              </svg>
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
          onChange={(input) => onChangeCarrier(parcel, input)}
          onClose={() => setEditingCarrier(false)}
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
