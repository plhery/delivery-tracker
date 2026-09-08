import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { activeTrackingCarrierId, carrierInfo } from '../lib/carriers';
import { localizedExpectedDelivery, useI18n } from '../i18n';
import { localizedParcelCompletionDate, parcelDeliveryEstimate, parcelDisplayStatusKey } from '../lib/parcelStatus';
import { currentEvent, isFinal } from '../lib/stages';
import { parcelIcon, parcelTone } from '../lib/parcelDesign';
import { userErrorMessage } from '../lib/userMessages';
import type { ParcelWithEvents } from '../types';
import { ProgressTrack } from './ProgressTrack';
import { Icon, PostageStamp } from './Icon';

type Drag = { x: number; y: number; pointerId: number; origin: number; width: number; direction: 'horizontal' | 'vertical' | null };

export function ParcelCard({ parcel, onOpen, onArchive, notice, variant = 'regular' }: {
  parcel: ParcelWithEvents;
  onOpen: (parcel: ParcelWithEvents) => void;
  onArchive?: (parcel: ParcelWithEvents) => Promise<unknown>;
  notice?: string;
  variant?: 'regular' | 'hero';
}) {
  const { locale, languageTag, t } = useI18n();
  const carrier = carrierInfo(activeTrackingCarrierId(parcel), locale);
  const current = currentEvent(parcel.events);
  const estimate = parcelDeliveryEstimate(parcel);
  const expectedDelivery = estimate ? localizedExpectedDelivery(estimate, t, languageTag) : null;
  const statusLabel = t(parcelDisplayStatusKey(parcel));
  const completionDate = localizedParcelCompletionDate(parcel, languageTag);
  const compact = Boolean((current && isFinal(current.stage)) || parcel.archivedAt);
  const parcelName = parcel.label || t('common.parcel');
  const tone = parcelTone(current?.stage);
  const hero = variant === 'hero';
  const drag = useRef<Drag | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const suppressClick = useRef(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [collapsing, setCollapsing] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [swipeThreshold, setSwipeThreshold] = useState(187);
  const armed = dragging && -offset >= swipeThreshold;
  useEffect(() => () => { if (releaseTimer.current) clearTimeout(releaseTimer.current); }, []);

  function suppressReleaseClick() {
    suppressClick.current = true;
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => { suppressClick.current = false; }, 350);
  }
  async function archive() {
    if (!onArchive || archiving) return;
    setArchiveError(null);
    setArchiving(true);
    setOffset(-(button.current?.getBoundingClientRect().width ?? 400));
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) await new Promise((resolve) => setTimeout(resolve, 180));
    setCollapsing(true);
    if (!reduced) await new Promise((resolve) => setTimeout(resolve, 180));
    try { await onArchive(parcel); }
    catch (reason) {
      setArchiving(false); setCollapsing(false); setOffset(0);
      setArchiveError(userErrorMessage(reason, t, 'detail.archiveFailed'));
    }
  }
  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (!onArchive || archiving || event.isPrimary === false || event.button > 0) return;
    setSwipeThreshold(Math.max(154, event.currentTarget.getBoundingClientRect().width * 0.52));
    drag.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, origin: offset, width: event.currentTarget.getBoundingClientRect().width, direction: null };
  }
  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const x = event.clientX - start.x;
    const y = event.clientY - start.y;
    if (start.direction === null) {
      if (Math.max(Math.abs(x), Math.abs(y)) < 8) return;
      start.direction = Math.abs(x) > Math.abs(y) * 1.25 ? 'horizontal' : 'vertical';
      if (start.direction === 'horizontal') {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDragging(true);
      }
    }
    if (start.direction !== 'horizontal') return;
    event.preventDefault();
    suppressClick.current = true;
    setOffset(Math.max(-Math.max(start.width, 88), Math.min(0, start.origin + x)));
  }
  function finishSwipe(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    drag.current = null;
    setDragging(false);
    if (!start || start.direction !== 'horizontal') return;
    suppressReleaseClick();
    const end = Math.min(0, start.origin + event.clientX - start.x);
    if (-end >= Math.max(154, start.width * 0.52)) void archive();
    else setOffset(end < -36 ? -88 : 0);
  }
  function cancelSwipe() {
    const wasHorizontal = drag.current?.direction === 'horizontal';
    drag.current = null;
    setDragging(false);
    if (wasHorizontal) { setOffset(offset < -44 ? -88 : 0); suppressReleaseClick(); }
  }
  const statusSummary = completionDate ? `${statusLabel} ${t('parcel.onDate', { date: completionDate })}` : statusLabel;
  const label = expectedDelivery ? t('parcel.ariaExpected', { name: parcelName, status: statusSummary, date: expectedDelivery }) : t('parcel.aria', { name: parcelName, status: statusSummary });

  return <div className={`parcel-card-swipe tone-${tone}${hero ? ' parcel-card-swipe--hero' : ''}${offset ? ' parcel-card-swipe--revealed' : ''}${collapsing ? ' parcel-card-swipe--collapsing' : ''}`}>
    <div className="parcel-card-swipe__clip">
      {onArchive && <button type="button" className={`parcel-card-swipe__archive${armed ? ' parcel-card-swipe__archive--armed' : ''}`} aria-label={t('parcel.archiveAria', { name: parcelName })}
        aria-hidden={offset > -8} tabIndex={offset <= -8 ? 0 : -1} disabled={archiving} style={{ visibility: offset <= -8 ? 'visible' : 'hidden' }} onClick={() => void archive()}><Icon name="archive" /><span>{archiving ? t('detail.archiving') : t('parcel.archive')}</span></button>}
      <button ref={button} type="button" className={`parcel-card${hero ? ' parcel-card--hero' : ''}${compact ? ' parcel-card--compact' : ''}${parcel.archivedAt ? ' parcel-card--archived' : ''}${dragging ? ' parcel-card--dragging' : ''}`}
        style={{ transform: `translateX(${offset}px)` }} disabled={archiving} aria-busy={archiving} aria-label={hero ? `${t('app.nextUp')}: ${label}` : label}
        onClick={() => { if (suppressClick.current) return; if (offset) setOffset(0); else onOpen(parcel); }}
        onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={finishSwipe} onPointerCancel={cancelSwipe}>
        {hero ? <>
          <span className="parcel-card__hero-top"><span className="eyebrow">{t('app.nextUp')}</span><span className="status-badge parcel-card__state"><i aria-hidden="true" />{statusLabel}</span></span>
          <span className="parcel-card__hero-main"><span>{expectedDelivery && <strong className="parcel-card__hero-date">{expectedDelivery}</strong>}<span className="parcel-card__label">{parcelName}</span></span><PostageStamp icon={parcelIcon(current?.stage)} /></span>
          <ProgressTrack stage={current?.stage ?? null} />
          {(parcel.syncStatus === 'error' || notice) && <span className="parcel-card__hero-notice">{parcel.syncStatus === 'error' ? t('parcel.syncAttention') : notice}</span>}
          <span className="parcel-card__hero-bottom"><span><strong>{carrier.name}</strong>{current?.location && <span>{current.location}</span>}</span><Icon name="arrow" /></span>
        </> : <>
          <span className="parcel-card__body"><span className="parcel-card__top"><strong className="parcel-card__label">{parcelName}</strong><span className="parcel-card__state">{statusLabel}</span></span>
            <span className="parcel-card__meta"><span className="parcel-card__carrier">{carrier.name}</span>{(expectedDelivery || completionDate) && <><span aria-hidden="true">·</span><span className={completionDate ? "parcel-card__completion" : "parcel-card__eta"}>{expectedDelivery || completionDate}</span></>}{current?.location && <><span aria-hidden="true">·</span><span className="parcel-card__location">{current.location}</span></>}</span>
            {parcel.syncStatus === 'error' ? <span className="parcel-card__notice">{t('parcel.syncAttention')}</span> : notice && <span className="parcel-card__notice">{notice}</span>}
            {!compact && <ProgressTrack stage={current?.stage ?? null} />}
          </span>
          <span className="parcel-card__stub" aria-hidden="true"><Icon name={parcelIcon(current?.stage)} /><span>{parcel.trackingNumber.slice(-4)}</span></span>
        </>}
      </button>
      {onArchive && !hero && !archiving && <ParcelActionsMenu label={t('parcel.actionsAria', { name: parcelName })} archiveLabel={t('parcel.archive')} archiving={archiving} onArchive={() => void archive()} />}
    </div>
    {archiveError && <p className="parcel-card__error" role="alert">{archiveError}</p>}
  </div>;
}

function ParcelActionsMenu({
  label,
  archiveLabel,
  archiving,
  onArchive,
}: {
  label: string;
  archiveLabel: string;
  archiving: boolean;
  onArchive: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const open = position !== null;

  const close = useCallback((restoreFocus = false) => {
    setPosition(null);
    if (restoreFocus) trigger.current?.focus();
  }, []);

  function toggle() {
    if (open) {
      close();
      return;
    }
    const bounds = trigger.current?.getBoundingClientRect();
    if (!bounds) return;
    const menuWidth = 188;
    const menuHeight = 58;
    const left = Math.min(
      Math.max(8, bounds.right - menuWidth),
      window.innerWidth - menuWidth - 8,
    );
    const below = bounds.bottom + 6;
    const top = below + menuHeight <= window.innerHeight - 8
      ? below
      : Math.max(8, bounds.top - menuHeight - 6);
    setPosition({ top, left });
  }

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();

    function handlePointerDown(event: globalThis.PointerEvent) {
      const target = event.target as Node;
      if (menu.current?.contains(target) || trigger.current?.contains(target)) return;
      close();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    }

    function handleViewportChange() {
      close();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [close, open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="parcel-card-menu"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={archiving}
        disabled={archiving}
        onClick={toggle}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {position && createPortal(
        <div
          ref={menu}
          className="parcel-card-menu__popover"
          role="menu"
          style={position}
        >
          <button
            type="button"
            role="menuitem"
            disabled={archiving}
            onClick={() => {
              close();
              onArchive();
            }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M4 5h16v4H4z" />
              <path d="M6 9v10h12V9" />
            </svg>
            <span>{archiveLabel}</span>
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
