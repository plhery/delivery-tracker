import { useState } from 'react';
import { pipMood } from '../../components/map/Pip';
import { defaultMode, formatKm, type Route } from '../../components/map/route';
import { WorldMap } from '../../components/map/WorldMap';
import { useI18n } from '../../i18n';
import { formatJourneyDuration } from '../../lib/passport';
import { isFinal } from '../../lib/stages';
import type { ParcelWithEvents, Stage } from '../../types';

const INSETS = {
  card: { top: 48, right: 18, bottom: 56, left: 18 },
  tile: { top: 36, right: 36, bottom: 72, left: 36 },
};

/** How long the journey took, from the first scan to the last. */
function journeyDuration(parcel: ParcelWithEvents, languageTag: string): string | null {
  const times = parcel.events.filter((event) => event.stage !== 'pending').map((event) => Date.parse(event.occurredAt)).filter(Number.isFinite);
  const duration = Math.max(...times) - Math.min(...times);
  return times.length > 1 && duration > 0 ? formatJourneyDuration(duration, languageTag) : null;
}

/**
 * The parcel's route in the card's own ink, with Pip beside the parcel's
 * place: across the top of the card on a phone, as a tile of its own beside
 * the card on a wide screen. The drawing is decorative; the button over it
 * opens the whole map.
 */
export function RouteMap({ route, parcel, stage, shape, pip, onOpen }: {
  route: Route | null;
  parcel: ParcelWithEvents;
  stage: Stage | null;
  shape: 'card' | 'tile';
  /** Pip stands on the map unless the card already shows him. */
  pip: boolean;
  onOpen: () => void;
}) {
  const { t, languageTag } = useI18n();
  const [time] = useState(() => new Date());
  const current = stage ?? undefined;
  const finished = !!stage && isFinal(stage);
  const mood = pip ? pipMood(current) : null;
  const duration = finished ? journeyDuration(parcel, languageTag) : null;
  return <div className={`peekp-map peekp-map--${shape}`} data-card-picture={shape === 'card' ? '' : undefined}>
    <div className="peekp-map__drawing" aria-hidden="true">
      {route && <WorldMap route={route} mode={defaultMode(route, current)} time={time} look="tint" labels="ends" context={false}
        live={!finished} peek pip={mood && { mood, ceiling: INSETS[shape].top }} languageTag={languageTag} insets={INSETS[shape]} className="peekp-map__canvas" />}
    </div>
    <button type="button" className="peekp-map__open" disabled={!route} onClick={onOpen} aria-label={t('map.open')} />
    {shape === 'tile' && route && route.stops.length > 0 && <p className="peekp-map__facts">
      {route.km >= 1 && <span>{finished ? formatKm(route.km, languageTag) : t('map.soFar', { distance: formatKm(route.km, languageTag) })}</span>}
      {route.countries.length > 1 && <span>{t('map.countries.many', { count: route.countries.length })}</span>}
      {duration && <span>{duration}</span>}
    </p>}
  </div>;
}
