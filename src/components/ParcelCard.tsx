import { AutoCarrierNotice } from './AutoCarrierNotice';
import { useEffect, useRef, useState } from 'react';
import { activeTrackingCarrierId, displayedCarrierId, carrierInfo } from '../lib/carriers';
import { localizedDatePhrase, localizedExpectedDelivery, useI18n } from '../i18n';
import { localizedParcelCompletionDate, parcelDeliveryEstimate, parcelDisplayStatusKey, parcelHasCarrierUpdate } from '../lib/parcelStatus';
import { currentEvent } from '../lib/stages';
import { parcelIcon } from '../lib/parcelDesign';
import { userErrorMessage } from '../lib/userMessages';
import type { ParcelWithEvents } from '../types';
import { CarrierMark } from './CarrierMark';
import { carrierBrand } from '../lib/carrierBrand';
import { Icon, PostageStamp } from './Icon';
import { bindSwipeRow, type SwipeRow } from '../lib/swipeRow';

export function ParcelCard({ parcel, onOpen, onArchive, notice, variant = 'regular' }: {
  parcel: ParcelWithEvents;
  onOpen: (parcel: ParcelWithEvents, source: HTMLButtonElement) => void;
  onArchive?: (parcel: ParcelWithEvents) => Promise<unknown>;
  notice?: string;
  variant?: 'regular' | 'hero';
}) {
  const { locale, languageTag, t } = useI18n();
  const carrier = carrierInfo(displayedCarrierId(parcel), locale);
  const deliveryCarrier = activeTrackingCarrierId(parcel);
  const deliveryLabel = deliveryCarrier !== carrier.id
    ? t('parcel.deliveryCarrier', { carrier: carrierInfo(deliveryCarrier, locale).name }) : null;
  const current = currentEvent(parcel.events);
  const estimate = parcelDeliveryEstimate(parcel);
  const expectedDelivery = estimate ? localizedExpectedDelivery(estimate, t, languageTag) : null;
  const statusLabel = t(parcelDisplayStatusKey(parcel));
  const completionDate = localizedParcelCompletionDate(parcel, languageTag, t);
  const parcelName = parcel.label || t('common.parcel');
  const branding = carrierBrand(carrier);
  const hero = variant === 'hero';
  // Carrier-reported stages already say what needs attention in the status line.
  const carrierIssue = ['customs', 'ready_for_pickup', 'failed_attempt', 'exception'].includes(current?.stage ?? '');
  const flag = (notice && !carrierIssue ? notice : null) ?? (parcel.syncStatus === 'error' ? t('attention.sync_error') : null);
  const flagChip = flag && <span className="parcel-card__notice"><Icon name={parcel.syncStatus === 'error' ? 'refresh' : 'clock'} />{flag}</span>;
  const row = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  const block = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const swipe = useRef<SwipeRow | null>(null);
  const [open, setOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const latest = useRef({ parcel, onArchive, t });
  useEffect(() => { latest.current = { parcel, onArchive, t }; });
  const swipeable = Boolean(onArchive);
  useEffect(() => {
    if (!swipeable || !row.current || !button.current || !tray.current || !block.current || !action.current) return;
    const controller = bindSwipeRow({ row: row.current, card: button.current, tray: tray.current, block: block.current, action: action.current }, {
      // The next parcel takes the hero's place, so the page keeps its height.
      reflow: !hero,
      onOpenChange: setOpen,
      onArchiveStart: () => { setArchiveError(null); setArchiving(true); },
      onArchive: async () => {
        const { parcel, onArchive, t } = latest.current;
        try {
          await onArchive?.(parcel);
          return true;
        } catch (reason) {
          setArchiving(false);
          setArchiveError(userErrorMessage(reason, t, 'detail.archiveFailed'));
          return false;
        }
      },
    });
    swipe.current = controller;
    return () => { controller.destroy(); swipe.current = null; };
  }, [swipeable, hero]);
  const statusSummary = completionDate ? `${statusLabel} ${localizedDatePhrase(completionDate, t)}` : statusLabel;
  const statusAria = expectedDelivery ? t('parcel.ariaExpected', { name: parcelName, status: statusSummary, date: expectedDelivery }) : t('parcel.aria', { name: parcelName, status: statusSummary });

  const label = [statusAria, flag, deliveryLabel].filter(Boolean).join('. ');

  return <div ref={row} data-parcel-id={parcel.id} data-carrier={carrier.id} style={branding.style} className={`parcel-card-swipe${hero ? ' parcel-card-swipe--hero' : ''}`}>
    <div className="parcel-card-swipe__clip">
      {onArchive && <div ref={tray} className="parcel-card-swipe__tray">
        <div ref={block} className="parcel-card-swipe__block">
          <button ref={action} type="button" className="parcel-card-swipe__archive" aria-label={t('parcel.archiveAria', { name: parcelName })}
            aria-hidden={!open} tabIndex={open ? 0 : -1} disabled={archiving} onClick={() => swipe.current?.archive()}><Icon name="archive" /><span>{t('parcel.archive')}</span></button>
        </div>
      </div>}
      <button ref={button} type="button" className={`parcel-card${hero ? ' parcel-card--hero' : ''}${parcel.archivedAt ? ' parcel-card--archived' : ''}`}
        disabled={archiving} aria-busy={archiving} aria-label={hero ? `${t('app.nextUp')}: ${label}` : label}
        onClick={(event) => { if (!swipe.current?.consumeClick()) onOpen(parcel, event.currentTarget); }}>
        {hero ? <>
          <span className="parcel-card__hero-top"><CarrierMark carrier={carrier} /><span className="parcel-card__next-label">{t('app.nextUp')}</span></span>
          <span className="parcel-card__hero-main"><strong className="parcel-card__label">{parcelName}</strong><PostageStamp icon={parcelIcon(current?.stage)} /></span>
          {deliveryLabel && <span className="parcel-card__sender">{deliveryLabel}</span>}
          <AutoCarrierNotice parcel={parcel} className="parcel-card__sender" />
          <span className="parcel-card__summary"><span className="parcel-card__state">{statusLabel}</span>{expectedDelivery && <><span aria-hidden="true">·</span><span className="parcel-card__eta">{expectedDelivery}</span></>}</span>
          {flagChip}
        </> : <>
          <span className="parcel-card__top"><CarrierMark carrier={carrier} />{(expectedDelivery || completionDate) && <span className={completionDate ? 'parcel-card__completion' : 'parcel-card__eta'}>{expectedDelivery || completionDate}</span>}</span>
          <strong className="parcel-card__label">{parcelName}</strong>
          {deliveryLabel && <span className="parcel-card__sender">{deliveryLabel}</span>}
          <AutoCarrierNotice parcel={parcel} className="parcel-card__sender" />
          {(!flag || parcelHasCarrierUpdate(parcel)) && <span className="parcel-card__state">{current?.stage === 'delivered' && <Icon name="check" />}{statusLabel}</span>}
          {flagChip}
        </>}
      </button>
    </div>
    {archiveError && <p className="parcel-card__error" role="alert">{archiveError}</p>}
  </div>;
}
