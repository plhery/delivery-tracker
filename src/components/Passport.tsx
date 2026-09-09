import { localizedCalendarDate } from '../lib/format';
import { trackAction } from '../lib/analytics';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import { formatJourneyDuration, passportStatistics } from '../lib/passport';
import type { ParcelWithEvents } from '../types';
import { Icon, type IconName } from './Icon';

function Seal({ icon, earned = true, numeral = '10' }: { icon: IconName; earned?: boolean; numeral?: string }) {
  return <span className={`passport-seal${earned ? '' : ' passport-seal--locked'}`} aria-hidden="true"><span className="passport-seal__frame">{icon === 'stamp' ? <span className="passport-seal__ten">{numeral}</span> : <Icon name={icon} />}</span></span>;
}

export function Passport({ parcels, loading }: { parcels: ParcelWithEvents[]; loading: boolean }) {
  const { t, languageTag } = useI18n();
  const stats = useMemo(() => passportStatistics(parcels), [parcels]);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [showAllStamps, setShowAllStamps] = useState(false);
  const idPrefix = useId();
  const detailId = (id: string) => `${idPrefix}-${id}`;
  const anchors = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (!expandedCard) return;
    const bubble = document.getElementById(`${idPrefix}-${expandedCard}`);
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && bubble?.contains(event.target)) return;
      if (bubble?.matches(':popover-open')) bubble.hidePopover();
    };
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [expandedCard, idPrefix]);
  const button = (id: string, className: string, label: string, children: ReactNode) => <button type="button" className={className} aria-label={label}
    ref={(node) => { if (node) anchors.current.set(id, node); else anchors.current.delete(id); }}
    popoverTarget={detailId(id)} aria-haspopup="dialog" aria-expanded={expandedCard === id} aria-controls={detailId(id)}
    onClick={() => { if (expandedCard !== id) trackAction('stamp-open'); }}>{children}</button>;
  const detail = (id: string, title: string, explanation: string) => <div id={detailId(id)} className="passport-bubble" popover="auto" role="dialog"
    aria-labelledby={`${detailId(id)}-title`} tabIndex={-1} onToggle={(event) => {
      const bubble = event.currentTarget;
      const open = bubble.matches(':popover-open');
      setExpandedCard((current) => open ? id : current === id ? null : current);
      if (!open) { delete bubble.dataset.positioned; return; }
      const anchor = anchors.current.get(id);
      if (!anchor) { bubble.hidePopover(); return; }
      const rect = anchor.getBoundingClientRect();
      const { width, height } = bubble.getBoundingClientRect();
      const below = rect.bottom + 10;
      const top = below + height <= window.innerHeight - 12 ? below : rect.top - height - 10;
      bubble.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2))}px`;
      bubble.style.top = `${Math.max(12, Math.min(window.innerHeight - height - 12, top))}px`;
      bubble.dataset.positioned = 'true';
      bubble.focus({ preventScroll: true });
    }}><h3 id={`${detailId(id)}-title`}>{title}</h3><p>{explanation}</p></div>;
  const format = (duration: number) => duration < 60_000 ? t('passport.underOneMinute') : formatJourneyDuration(duration, languageTag);
  const stamps: { title: MessageKey; explanation: MessageKey; icon: IconName; tone: string; count: number; total: number; numeral?: string }[] = [
    { title: 'passport.firstArrival', explanation: 'passport.firstExplanation', icon: 'parcel', tone: 'green', count: stats.deliveredCount, total: 1 },
    { title: 'passport.doubleDigits', explanation: 'passport.tenExplanation', icon: 'stamp', tone: 'lilac', count: stats.deliveredCount, total: 10 },
    { title: 'passport.wellConnected', explanation: 'passport.carrierExplanation', icon: 'globe', tone: 'blue', count: stats.carrierCount, total: 3 },
    { title: 'passport.expressArrival', explanation: 'passport.expressExplanation', icon: 'express', tone: 'peach', count: stats.fastestDelivery && stats.fastestDelivery.duration <= 48 * 3600_000 ? 1 : 0, total: 1 },
    { title: 'passport.acrossBorders', explanation: 'passport.acrossExplanation', icon: 'border', tone: 'blue', count: stats.crossBorderCount, total: 1 },
    { title: 'passport.aroundWorld', explanation: 'passport.aroundExplanation', icon: 'worldMap', tone: 'green', count: stats.originCountries.length, total: 5 },
    { title: 'passport.theRegular', explanation: 'passport.regularExplanation', icon: 'stamp', tone: 'lilac', count: stats.deliveredCount, total: 25, numeral: '25' },
    { title: 'passport.rightNextDoor', explanation: 'passport.domesticExplanation', icon: 'houses', tone: 'green', count: stats.domesticDeliveryCount, total: 1 },
    { title: 'passport.worthTheWait', explanation: 'passport.waitExplanation', icon: 'hourglass', tone: 'ochre', count: stats.longWaitDeliveryCount, total: 1 },
    { title: 'passport.busyDoorstep', explanation: 'passport.busyExplanation', icon: 'parcels', tone: 'peach', count: stats.maxDeliveriesInOneDay, total: 3 },
    { title: 'passport.pickedUp', explanation: 'passport.pickupExplanation', icon: 'storefront', tone: 'blue', count: stats.pickupDeliveryCount, total: 1 },
    { title: 'passport.homeForHolidays', explanation: 'passport.holidayExplanation', icon: 'gift', tone: 'green', count: stats.decemberDeliveryCount, total: 1 },
  ];
  const upcoming = new Set(stamps.filter((stamp) => stamp.count < stamp.total).slice(0, 3).map((stamp) => stamp.title));
  const visibleStamps = showAllStamps ? stamps : stamps.filter((stamp) => stamp.count >= stamp.total || upcoming.has(stamp.title));
  const hasMoreStamps = stamps.some((stamp) => stamp.count < stamp.total && !upcoming.has(stamp.title));
  const progress = (stamp: typeof stamps[number]) => stamp.icon === 'express' ? t('passport.underTwoDays') : `${Math.min(stamp.count, stamp.total)} / ${stamp.total}`;
  const timingExplanation = `${t(stats.durationSampleCount === 1 ? 'passport.timedJourneys.one' : 'passport.timedJourneys.many', { count: stats.durationSampleCount })}. ${t('passport.timingExplanation')}`;
  if (loading) return <div className="passport-loading" role="status" aria-label={t('app.loadingParcels')}><div className="skeleton" /><div className="skeleton" /></div>;

  return <div className="passport-page">
    <div className="passport-cover">
      {button('delivered', 'passport-cover__main', `${stats.deliveredCount} ${t('passport.delivered', { count: stats.deliveredCount })}`, <>
        <span><strong className="passport-cover__count">{stats.deliveredCount.toLocaleString(languageTag)}</strong><span>{t('passport.delivered', { count: stats.deliveredCount })}</span></span><Seal icon="parcel" />
      </>)}
      {detail('delivered', t('passport.delivered', { count: stats.deliveredCount }), t('passport.deliveredExplanation'))}
    </div>
    <section className="passport-stamps" aria-labelledby="passport-stamps-title">
      <h2 id="passport-stamps-title">{t('passport.stamps')}</h2>
      <div className="passport-stamps__grid" id={`${idPrefix}-stamps`}>{visibleStamps.map((stamp) => {
        const earned = stamp.count >= stamp.total;
        return <div key={stamp.title}>{button(stamp.title, `stamp-card tone-${stamp.tone}${earned ? ' stamp-card--earned' : ''}`,
          [t(stamp.title), earned ? '' : progress(stamp)].filter(Boolean).join(', '),
          <><Seal icon={stamp.icon} earned={earned} numeral={stamp.numeral} /><span>{t(stamp.title)}</span></>)}</div>;
      })}</div>
      {hasMoreStamps && <button type="button" className="passport-collection-toggle" aria-expanded={showAllStamps} aria-controls={`${idPrefix}-stamps`} onClick={() => setShowAllStamps((value) => !value)}>{t(showAllStamps ? 'passport.showLess' : 'passport.showAll')}</button>}
      {visibleStamps.map((stamp) => <div key={stamp.title}>{detail(stamp.title, t(stamp.title), `${t(stamp.explanation)}${stamp.count >= stamp.total ? '' : `\n${progress(stamp)}`}`)}</div>)}
    </section>
    <section className="passport-times" aria-label={t('passport.deliveryTimes')}>
      {stats.averageDeliveryDuration != null && stats.fastestDelivery ? <>
        <div className="passport-times__grid">
          {button('average', 'time-card', `${t('passport.average')}, ${format(stats.averageDeliveryDuration)}`, <><strong>{format(stats.averageDeliveryDuration)}</strong><span>{t('passport.average')}</span></>)}
          {button('best', 'time-card', `${t('passport.personalBest')}, ${format(stats.fastestDelivery.duration)}`, <><strong>{format(stats.fastestDelivery.duration)}</strong><span>{t('passport.personalBest')}</span></>)}
        </div>
        {detail('average', t('passport.average'), timingExplanation)}
        {detail('best', t('passport.personalBest'), `${stats.fastestDelivery.label || t('common.parcel')} · ${localizedCalendarDate(new Date(stats.fastestDelivery.deliveredAt), languageTag)}\n${timingExplanation}`)}
      </> : <p className="passport-note">{t('passport.waitingForTimes')}</p>}
    </section>
    {stats.originCountries.length > 0 && <section className="passport-countries" aria-labelledby="passport-countries-title">
      <div className="passport-section-heading"><h2 id="passport-countries-title">
        {button('countries', 'passport-heading-button', t('passport.firstSeenIn'), t('passport.firstSeenIn'))}
      </h2></div>
      {detail('countries', t('passport.firstSeenIn'), t('passport.countryExplanation'))}
      <div className="country-list">{stats.originCountries.slice(0, 3).map((country) => {
        const name = new Intl.DisplayNames([languageTag], { type: 'region' }).of(country.code) ?? country.code;
        return <div className="country-row" key={country.code}>
          <span className="country-row__flag" aria-hidden="true">{[...country.code].map((letter) => String.fromCodePoint(letter.charCodeAt(0) + 127397)).join('')}</span>
          <span>{name}</span><span className="country-row__count">{country.count.toLocaleString(languageTag)}</span>
        </div>;
      })}</div>
    </section>}
  </div>;
}
