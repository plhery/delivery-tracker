import { useState } from 'react';
import { localizedEventDescription, stageLabel, useI18n } from '../i18n';
import { currentEvent, sortEventsDesc, stageMeta } from '../lib/stages';
import type { TrackingEvent } from '../types';

/** The parcel's journey, newest update on top. */
export function Timeline({
  events,
  syncing = false,
  preview = false,
}: {
  events: TrackingEvent[];
  syncing?: boolean;
  preview?: boolean;
}) {
  const { languageTag, t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const sorted = sortEventsDesc(events);
  const visible = preview && !expanded ? sorted.slice(0, 3) : sorted;
  const current = currentEvent(events);

  if (sorted.length === 0) {
    return (
      <p className="timeline-empty">
        {syncing
          ? t('timeline.emptySyncing')
          : t('timeline.empty')}
      </p>
    );
  }

  return (
    <>
    <ol className="timeline" aria-label={t('timeline.label')}>
      {visible.map((event) => {
        const meta = stageMeta(event.stage);
        const isCurrent = event.id === current?.id;
        return (
          <li
            key={event.id}
            className={`timeline__item${isCurrent ? ' timeline__item--latest' : ''}`}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <span
              className={`timeline__dot timeline__dot--${meta.tone}`}
              aria-hidden="true"
            />
            <div className="timeline__content">
              <div className="timeline__stage">
                {syncing && isCurrent && event.stage === 'pending'
                  ? t('timeline.syncing')
                  : stageLabel(t, event.stage)}
              </div>
              <div className="timeline__description">{localizedEventDescription(event.description, t)}</div>
              <div className="timeline__meta">
                {event.location ? `${event.location} · ` : ''}
                {Number.isFinite(Date.parse(event.occurredAt)) ? new Intl.DateTimeFormat(languageTag, {
                  dateStyle: 'medium', timeStyle: 'short',
                }).format(new Date(event.occurredAt)) : event.occurredAt}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
    {preview && sorted.length > 3 && <button type="button" className="timeline-expand" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{t(expanded ? 'design.lessJourney' : 'design.fullJourney')}<span aria-hidden="true">{expanded ? '−' : '+'}</span></button>}
    </>
  );
}
