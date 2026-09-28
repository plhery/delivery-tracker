import { localizedCalendarDate } from '../lib/format';
import { countryFlag, countryName, trackingPlace } from '../lib/trackingLocation';
import { localizedEventDescription, stageLabel, useI18n } from '../i18n';
import { currentEvent, sortEventsDesc } from '../lib/stages';
import type { TrackingEvent } from '../types';

/** The whole journey grouped by local calendar day, newest first. */
export function TrackingJournal({ events, syncing = false }: { events: TrackingEvent[]; syncing?: boolean }) {
  const { languageTag, t } = useI18n();
  const current = currentEvent(events);
  const groups = new Map<string, { date: Date | null; events: TrackingEvent[] }>();
  for (const event of sortEventsDesc(events)) {
    const date = new Date(event.occurredAt);
    const valid = Number.isFinite(date.getTime());
    const key = valid ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : event.occurredAt;
    if (!groups.has(key)) groups.set(key, { date: valid ? date : null, events: [] });
    groups.get(key)!.events.push(event);
  }
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const dayLabel = (date: Date | null, fallback: string) => !date ? fallback
    : sameDay(date, now) ? t('time.today') : sameDay(date, yesterday) ? t('time.yesterday')
      : localizedCalendarDate(date, languageTag) + (date.getFullYear() !== now.getFullYear() ? ` ${date.getFullYear()}` : '');

  return <details className="tracking-journal" open>
    <summary><span>{t('timeline.label')}</span><span className="tracking-journal__count">{t(events.length === 1 ? 'detail.updateCount.one' : 'detail.updateCount.many', { count: events.length })}<svg aria-hidden="true" viewBox="0 0 20 20"><path d="m5 8 5 5 5-5" /></svg></span></summary>
    {!events.length ? <p className="timeline-empty">{t(syncing ? 'timeline.emptySyncing' : 'timeline.empty')}</p>
      : <ol className="tracking-journal__days" aria-label={t('timeline.label')}>
        {[...groups].map(([key, group]) => <li key={key}>
          <h3>{dayLabel(group.date, key)}</h3>
          <ol className="tracking-journal__events">
            {group.events.map(event => {
              const date = new Date(event.occurredAt);
              const valid = Number.isFinite(date.getTime());
              const isCurrent = event.id === current?.id;
              return <li key={event.id} className={isCurrent ? 'tracking-journal__current' : undefined} aria-current={isCurrent ? 'step' : undefined}>
                <time dateTime={valid ? event.occurredAt : undefined}>{valid ? new Intl.DateTimeFormat(languageTag, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date) : '—'}</time>
                <div><p>{syncing && isCurrent && event.stage === 'pending' ? t('timeline.syncing') : localizedEventDescription(event.description, t) || stageLabel(t, event.stage)}</p>
                  {event.location?.trim() && <EventPlace location={event.location} />}
                </div>
              </li>;
            })}
          </ol>
        </li>)}
      </ol>}
  </details>;
}

/** The flag leads; a location that only names its country shows that country's name. */
function EventPlace({ location }: { location: string }) {
  const { languageTag } = useI18n();
  const { country, place } = trackingPlace(location);
  if (!country) return <span className="tracking-journal__location">{place}</span>;
  const name = countryName(country, languageTag);
  return <span className="tracking-journal__location">
    <span className="tracking-journal__flag" aria-hidden="true" title={name}>{countryFlag(country)}</span>
    {place || name}{place && <span className="sr-only">, {name}</span>}
  </span>;
}
