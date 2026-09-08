import { localizedCalendarDate } from '../lib/format';
import { trackAction } from '../lib/analytics';
import { useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useI18n, type MessageKey } from '../i18n';
import { formatJourneyDuration, passportStatistics } from '../lib/passport';
import { useSheetDialog } from '../lib/modal';
import type { ParcelWithEvents } from '../types';
import { Icon, type IconName } from './Icon';

type PassportDetail = { title: string; value: string; explanation: string; icon: IconName; tone: string; earned?: boolean };

function Seal({ icon, earned = true }: { icon: IconName; earned?: boolean }) {
  return <span className={`passport-seal${earned ? '' : ' passport-seal--locked'}`} aria-hidden="true"><Icon name={icon} />{!earned && <span className="passport-seal__lock"><Icon name="lock" /></span>}</span>;
}

export function Passport({ parcels, loading }: { parcels: ParcelWithEvents[]; loading: boolean }) {
  const { t, locale, languageTag } = useI18n();
  const stats = useMemo(() => passportStatistics(parcels), [parcels]);
  const [detail, setDetail] = useState<PassportDetail | null>(null);
  const format = (duration: number | null) => duration == null ? '—' : duration < 60_000 ? t('passport.underOneMinute') : formatJourneyDuration(duration, languageTag);
  const quantity = (count: number) => t(count === 1 ? 'passport.parcels.one' : 'passport.parcels.many', { count });
  const stamps: { title: MessageKey; explanation: MessageKey; icon: IconName; tone: string; count: number; total: number }[] = [
    { title: 'passport.firstArrival', explanation: 'passport.firstExplanation', icon: 'parcel', tone: 'green', count: stats.deliveredCount, total: 1 },
    { title: 'passport.doubleDigits', explanation: 'passport.tenExplanation', icon: 'stamp', tone: 'lilac', count: stats.deliveredCount, total: 10 },
    { title: 'passport.wellConnected', explanation: 'passport.carrierExplanation', icon: 'globe', tone: 'blue', count: stats.carrierCount, total: 3 },
    { title: 'passport.expressArrival', explanation: 'passport.expressExplanation', icon: 'express', tone: 'peach', count: stats.fastestDelivery && stats.fastestDelivery.duration <= 48 * 3600_000 ? 1 : 0, total: 1 },
  ];
  const earnedCount = stamps.filter((stamp) => stamp.count >= stamp.total).length;
  if (loading) return <div className="passport-loading" role="status" aria-label={t('app.loadingParcels')}><div className="skeleton" /><div className="skeleton" /></div>;

  return <div className="passport-page">
    <button type="button" className="passport-cover" onClick={() => { trackAction('stamp-open'); setDetail({ title: t('passport.delivered'), value: String(stats.deliveredCount), explanation: t('passport.deliveredExplanation'), icon: 'parcel', tone: 'green' }); }}>
      <span className="passport-cover__top"><span className="eyebrow">{t('passport.allTime')}</span><Icon name="globe" /></span>
      <span className="passport-cover__main"><span><strong className="passport-cover__count">{stats.deliveredCount.toLocaleString(languageTag)}</strong><span>{t('passport.delivered')}</span></span><Seal icon="parcel" earned={stats.deliveredCount > 0} /></span>
      <span className="passport-cover__footer"><span><strong>{stats.activeCount}</strong> {t('passport.onTheWay')}</span><span><strong>{stats.carrierCount}</strong> {t('passport.carriers')}</span><Icon name="arrow" /></span>
    </button>
    <section className="passport-times" aria-labelledby="passport-times-title"><h2 id="passport-times-title">{t('passport.deliveryTimes')}</h2>
      <div className="passport-times__grid">{([
        { title: t('passport.average'), value: format(stats.averageDeliveryDuration), icon: 'clock', tone: 'blue', explanation: t(stats.durationSampleCount ? 'passport.timingExplanation' : 'passport.noTimingExplanation') },
        { title: t('passport.personalBest'), value: format(stats.fastestDelivery?.duration ?? null), icon: 'express', tone: 'peach', explanation: stats.fastestDelivery ? `${stats.fastestDelivery.label || t('common.parcel')} · ${localizedCalendarDate(new Date(stats.fastestDelivery.deliveredAt), languageTag)}\n${t('passport.timingExplanation')}` : t('passport.noTimingExplanation') },
      ] satisfies PassportDetail[]).map((card) => <button type="button" className={`time-card tone-${card.tone}`} key={card.title} onClick={() => { trackAction('stamp-open'); setDetail(card); }}><span><Icon name={card.icon} /><Icon name="arrow" /></span><strong>{card.value}</strong><span>{card.title}</span></button>)}</div>
      <p className="passport-note">{stats.durationSampleCount ? t(stats.durationSampleCount === 1 ? 'passport.timedJourneys.one' : 'passport.timedJourneys.many', { count: stats.durationSampleCount }) : t('passport.waitingForTimes')}</p>
    </section>
    <section className="passport-stamps" aria-labelledby="passport-stamps-title"><div className="section-heading"><h2 id="passport-stamps-title">{t('passport.stamps')}</h2><span>{earnedCount} / {stamps.length}</span></div>
      <div className="passport-stamps__grid">{stamps.map((stamp) => <button type="button" key={stamp.title} className={`stamp-card tone-${stamp.tone}${stamp.count >= stamp.total ? ' stamp-card--earned' : ''}`}
        onClick={() => { trackAction('stamp-open'); setDetail({ title: t(stamp.title), value: stamp.count >= stamp.total ? t('passport.unlocked') : stamp.icon === 'express' ? t('passport.underTwoDays') : `${Math.min(stamp.count, stamp.total)} / ${stamp.total}`, explanation: t(stamp.explanation), icon: stamp.icon, tone: stamp.tone, earned: stamp.count >= stamp.total }); }}>
        <Seal icon={stamp.icon} earned={stamp.count >= stamp.total} /><strong>{t(stamp.title)}</strong><span>{stamp.count >= stamp.total ? t('passport.unlocked') : stamp.icon === 'express' ? t('passport.underTwoDays') : `${Math.min(stamp.count, stamp.total)} / ${stamp.total}`}</span>
      </button>)}</div>
    </section>
    {stats.originCountries.length > 0 && <section className="passport-countries" aria-labelledby="passport-countries-title"><div className="section-heading"><h2 id="passport-countries-title">{t('passport.firstSeenIn')}</h2><span>{stats.originCountries.length}</span></div>
      <div className="country-list">{stats.originCountries.slice(0, 3).map((country, index) => {
        const name = new Intl.DisplayNames([locale], { type: 'region' }).of(country.code) ?? country.code;
        return <button type="button" className={`country-row tone-${['blue', 'lilac', 'peach'][index]}`} key={country.code} onClick={() => { trackAction('stamp-open'); setDetail({ title: name, value: quantity(country.count), explanation: t('passport.countryExplanation'), icon: 'globe', tone: ['blue', 'lilac', 'peach'][index] }); }}>
          <span className="country-row__number">{String(index + 1).padStart(2, '0')}</span><span className="country-row__flag" aria-hidden="true">{[...country.code].map((letter) => String.fromCodePoint(letter.charCodeAt(0) + 127397)).join('')}</span>
          <span className="country-row__body"><span><strong>{name}</strong><span>{country.count}</span></span><span className="country-row__track"><span style={{ '--progress': `${country.count / stats.originCountries[0].count * 100}%` } as CSSProperties} /></span></span>
        </button>;
      })}</div>
    </section>}
    {detail && <PassportDetailSheet detail={detail} onClose={() => setDetail(null)} />}
  </div>;
}

function PassportDetailSheet({ detail, onClose: onDismissed }: { detail: PassportDetail; onClose: () => void }) {
  const { t } = useI18n();
  const [dialog, onClose] = useSheetDialog<HTMLDivElement>(true, onDismissed);
  return createPortal(<div className="sheet-backdrop" onClick={onClose}><div ref={dialog} className={`sheet passport-detail tone-${detail.tone}`} role="dialog" aria-modal="true" aria-labelledby="passport-detail-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
    <div className="sheet__grabber" aria-hidden="true" /><div className="sheet__heading"><h2 className="sheet__title" id="passport-detail-title">{detail.title}</h2><button type="button" className="sheet__close" aria-label={t('common.close')} onClick={onClose}><Icon name="close" /></button></div>
    <Seal icon={detail.icon} earned={detail.earned} /><strong className="passport-detail__value">{detail.value}</strong><p>{detail.explanation}</p>
  </div></div>, document.body);
}
