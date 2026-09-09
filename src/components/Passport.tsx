import { localizedCalendarDate } from '../lib/format';
import { trackAction } from '../lib/analytics';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import { formatJourneyDuration, passportStatistics } from '../lib/passport';
import type { ParcelWithEvents } from '../types';
import { Icon, type IconName } from './Icon';

function Seal({ icon, earned = true }: { icon: IconName; earned?: boolean }) {
  return <span className={`passport-seal${earned ? '' : ' passport-seal--locked'}`} aria-hidden="true"><span className="passport-seal__frame">{icon === 'stamp' ? <span className="passport-seal__ten">10</span> : <Icon name={icon} />}</span></span>;
}

export function Passport({ parcels, loading }: { parcels: ParcelWithEvents[]; loading: boolean }) {
  const { t, locale, languageTag } = useI18n();
  const stats = useMemo(() => passportStatistics(parcels), [parcels]);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const idPrefix = useId();
  const detailId = (id: string) => `${idPrefix}-${id}`;
  const button = (id: string, className: string, label: string, children: ReactNode) => <button type="button" className={className} aria-label={label}
    aria-expanded={expandedCard === id} aria-controls={detailId(id)} aria-describedby={expandedCard === id ? detailId(id) : undefined}
    onClick={() => {
      if (expandedCard !== id) trackAction('stamp-open');
      setExpandedCard((current) => current === id ? null : id);
    }}>{children}</button>;
  const detail = (id: string, explanation: string) => <div id={detailId(id)} className="passport-card__detail" hidden={expandedCard !== id}>{explanation}</div>;
  const format = (duration: number) => duration < 60_000 ? t('passport.underOneMinute') : formatJourneyDuration(duration, languageTag);
  const stamps: { title: MessageKey; explanation: MessageKey; icon: IconName; tone: string; count: number; total: number }[] = [
    { title: 'passport.firstArrival', explanation: 'passport.firstExplanation', icon: 'parcel', tone: 'green', count: stats.deliveredCount, total: 1 },
    { title: 'passport.doubleDigits', explanation: 'passport.tenExplanation', icon: 'stamp', tone: 'lilac', count: stats.deliveredCount, total: 10 },
    { title: 'passport.wellConnected', explanation: 'passport.carrierExplanation', icon: 'globe', tone: 'blue', count: stats.carrierCount, total: 3 },
    { title: 'passport.expressArrival', explanation: 'passport.expressExplanation', icon: 'express', tone: 'peach', count: stats.fastestDelivery && stats.fastestDelivery.duration <= 48 * 3600_000 ? 1 : 0, total: 1 },
  ];
  const progress = (stamp: typeof stamps[number]) => stamp.icon === 'express' ? t('passport.underTwoDays') : `${Math.min(stamp.count, stamp.total)} / ${stamp.total}`;
  const timingExplanation = `${t(stats.durationSampleCount === 1 ? 'passport.timedJourneys.one' : 'passport.timedJourneys.many', { count: stats.durationSampleCount })}. ${t('passport.timingExplanation')}`;
  if (loading) return <div className="passport-loading" role="status" aria-label={t('app.loadingParcels')}><div className="skeleton" /><div className="skeleton" /></div>;

  return <div className="passport-page" onKeyDown={(event) => { if (event.key === 'Escape' && expandedCard) { event.stopPropagation(); setExpandedCard(null); } }}>
    <div className="passport-cover">
      {button('delivered', 'passport-cover__main', `${stats.deliveredCount} ${t('passport.delivered')}`, <>
        <span><strong className="passport-cover__count">{stats.deliveredCount.toLocaleString(languageTag)}</strong><span>{t('passport.delivered')}</span></span><Seal icon="parcel" />
      </>)}
      {detail('delivered', t('passport.deliveredExplanation'))}
    </div>
    <section className="passport-stamps" aria-labelledby="passport-stamps-title">
      <h2 id="passport-stamps-title">{t('passport.stamps')}</h2>
      <div className="passport-stamps__grid">{stamps.map((stamp) => {
        const earned = stamp.count >= stamp.total;
        return <div key={stamp.title}>{button(stamp.title, `stamp-card tone-${stamp.tone}${earned ? ' stamp-card--earned' : ''}`,
          [t(stamp.title), earned ? '' : progress(stamp)].filter(Boolean).join(', '),
          <><Seal icon={stamp.icon} earned={earned} /><span>{t(stamp.title)}</span></>)}</div>;
      })}</div>
      {stamps.map((stamp) => <div key={stamp.title}>{detail(stamp.title, `${t(stamp.explanation)}${stamp.count >= stamp.total ? '' : `\n${progress(stamp)}`}`)}</div>)}
    </section>
    <section className="passport-times" aria-label={t('passport.deliveryTimes')}>
      {stats.averageDeliveryDuration != null && stats.fastestDelivery ? <>
        <div className="passport-times__grid">
          {button('average', 'time-card', `${t('passport.average')}, ${format(stats.averageDeliveryDuration)}`, <><strong>{format(stats.averageDeliveryDuration)}</strong><span>{t('passport.average')}</span></>)}
          {button('best', 'time-card', `${t('passport.personalBest')}, ${format(stats.fastestDelivery.duration)}`, <><strong>{format(stats.fastestDelivery.duration)}</strong><span>{t('passport.personalBest')}</span></>)}
        </div>
        {detail('average', timingExplanation)}
        {detail('best', `${stats.fastestDelivery.label || t('common.parcel')} · ${localizedCalendarDate(new Date(stats.fastestDelivery.deliveredAt), languageTag)}\n${timingExplanation}`)}
      </> : <p className="passport-note">{t('passport.waitingForTimes')}</p>}
    </section>
    {stats.originCountries.length > 0 && <section className="passport-countries" aria-labelledby="passport-countries-title">
      <div className="passport-section-heading"><h2 id="passport-countries-title">{t('passport.firstSeenIn')}</h2>
        {button('countries', 'passport-help', `${t('passport.firstSeenIn')}: ${t('passport.detailsHint')}`, <span aria-hidden="true">?</span>)}
      </div>
      {detail('countries', t('passport.countryExplanation'))}
      <div className="country-list">{stats.originCountries.slice(0, 3).map((country) => {
        const name = new Intl.DisplayNames([locale], { type: 'region' }).of(country.code) ?? country.code;
        return <div className="country-row" key={country.code}>
          <span className="country-row__flag" aria-hidden="true">{[...country.code].map((letter) => String.fromCodePoint(letter.charCodeAt(0) + 127397)).join('')}</span>
          <span>{name}</span><span className="country-row__count">{country.count.toLocaleString(languageTag)}</span>
        </div>;
      })}</div>
    </section>}
  </div>;
}
