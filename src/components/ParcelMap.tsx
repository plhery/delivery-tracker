import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { useNear } from '../lib/inView';
import { useModalDialog } from '../lib/modal';
import { countryName } from 'universal-parcel-scraper/app';
import type { ParcelWithEvents, Stage } from '../types';
import { Icon } from './Icon';
import { countryLabel, useWorld } from './map/geography';
import { countryPlace, defaultMode, flag, formatKm, hasNearView, placeName, routeFromEvents, type MapMode, type Route } from './map/route';
import { pipMood } from './map/Pip';
import { WorldMap, type PipPlacing } from './map/WorldMap';
import './ParcelMap.css';

/**
 * The parcel's route once its scans have places and the map data has loaded.
 * `placed` is known at once, so the card can keep room for the map while it loads.
 * A card that draws no map passes `wanted` as false, and never asks for the map data.
 */
export function useParcelRoute(parcel: ParcelWithEvents, languageTag: string, wanted = true): { placed: boolean; route: Route | null } {
  const placed = wanted && parcel.events.some((event) => event.place);
  const ready = useWorld(placed);
  const route = useMemo(() => {
    if (!placed || !ready) return null;
    const label = parcel.destinationCountry ? countryLabel(parcel.destinationCountry) : null;
    const destination = parcel.destinationCountry && label
      ? countryPlace(parcel.destinationCountry, countryName(parcel.destinationCountry, languageTag), label) : undefined;
    return routeFromEvents(parcel.events, destination, (code) => countryName(code, languageTag));
  }, [placed, ready, parcel.events, parcel.destinationCountry, languageTag]);
  return { placed, route };
}

/** The opened map has room for a facility's own name, so it says "Zürich-Mülligen" where the card says "Zürich". */
function useRouteLabel(route: Route): string {
  const { t } = useI18n();
  const origin = route.origin ? placeName(route.origin.place, true) : '';
  const finish = route.destination ?? route.current?.place;
  const end = finish ? placeName(finish, true) : origin;
  return end === origin ? t('map.labelOne', { place: origin }) : t('map.label', { from: origin, to: end });
}

/** Pip keeps below the top row of the parcel's page, and of Next up alike, so both show the same picture. */
const pip = (stage: Stage | undefined, floor?: number): PipPlacing | null => {
  const mood = pipMood(stage);
  return mood && { mood, ceiling: 52, floor };
};

/** The parcel's dot pulses until the journey is over. */
const travelling = (stage?: Stage) => stage !== 'delivered' && stage !== 'returned';

/** The route, drawn in the card's own ink across the top of the parcel's card, with Pip beside the parcel's place. */
export function RouteEngraving({ route, stage, onOpen }: { route: Route | null; stage?: Stage; onOpen: () => void }) {
  const { languageTag } = useI18n();
  const [time] = useState(() => new Date());
  // The globe button beside the bell is the accessible way in; the drawing is a large tap target.
  return <div className="detail__engraving" onClick={onOpen} aria-hidden="true" data-card-picture="">
    {route && <WorldMap route={route} mode={defaultMode(route, stage)} time={time} look="tint" labels="ends" context={false} live={travelling(stage)} peek
      pip={pip(stage)} languageTag={languageTag} insets={{ top: 40, right: 16, bottom: 44, left: 16 }} className="detail__engraving-map" />}
  </div>;
}

/**
 * The same engraving on the Next up card, so opening the card lands on the same picture.
 * The card is one button: the drawing takes no touches of its own. Its title is written over the bottom of the map, so Pip stays above it.
 */
export function NextUpEngraving({ route, stage }: { route: Route | null; stage?: Stage }) {
  const { languageTag } = useI18n();
  const [time] = useState(() => new Date());
  return <span className="parcel-card__engraving" aria-hidden="true">
    {route && <WorldMap route={route} mode={defaultMode(route, stage)} time={time} look="tint" labels="ends" context={false} live={travelling(stage)}
      pip={pip(stage, 140)} languageTag={languageTag} insets={{ top: 40, right: 16, bottom: 28, left: 16 }} className="parcel-card__engraving-map" />}
  </span>;
}

/** Room for the date in the card's top row, and for the land to fade in from under the words, which end short of the route. */
const CARD_ROUTE_INSETS = { top: 36, right: 20, bottom: 16, left: 78 };

/**
 * A parcel's whole journey, small, at the end of its card. It belongs to the
 * card's picture and is not there to be read: no names, no Pip, no pulse, and
 * a line and dots as pale as the map they lie on. The card it stands in gives the
 * ink (`--tone`) and the surface (`--tone-surface`). It is drawn once the card
 * comes near the screen, so a long list draws only what is looked at.
 */
export function CardRoute({ route }: { route: Route | null }) {
  const { languageTag } = useI18n();
  const [time] = useState(() => new Date());
  const frame = useRef<HTMLSpanElement>(null);
  const near = useNear(frame);
  return <span ref={frame} className="card-route" aria-hidden="true">
    {route && near && <WorldMap route={route} mode="journey" time={time} look="tint" labels="none" context={false} live={false} quiet
      languageTag={languageTag} insets={CARD_ROUTE_INSETS} className="card-route__map" />}
  </span>;
}

function RouteSummary({ route, stage }: { route: Route; stage?: Stage }) {
  const { t, languageTag } = useI18n();
  const origin = route.origin;
  const current = route.current;
  if (!origin || !current) return null;
  const delivered = stage === 'delivered';
  // A finished journey has a length, not a distance "so far".
  const finished = delivered || stage === 'returned';
  const end = route.destination ?? current.place;
  const endLabel = delivered ? t('map.delivered') : route.destination ? t('map.to') : route.latestLocated ? t('map.now') : t('map.lastSeen');
  const total = route.km + (route.remainingKm ?? 0);
  const progress = delivered || !route.destination ? 1 : total ? route.km / total : 0;
  const single = route.stops.length === 1 && !route.destination;
  return <div className="parcel-map__summary" data-single={single || undefined}>
    {!single && <div>
      <span>{t('map.from')}</span>
      <strong>{placeName(origin.place, true)}</strong>
      <small><span aria-hidden="true">{flag(origin.place.country)}</span> {countryName(origin.place.country, languageTag)}</small>
    </div>}
    <div data-end>
      <span>{endLabel}</span>
      <strong>{placeName(end, true)}</strong>
      <small><span aria-hidden="true">{flag(end.country)}</span> {countryName(end.country, languageTag)}</small>
    </div>
    {!single && <div className="parcel-map__line" style={{ '--progress': progress } as CSSProperties} aria-hidden="true"><span /><i /></div>}
    {!single && <p className="parcel-map__facts">
      {route.km >= 1 && <span>{finished ? formatKm(route.km, languageTag) : t('map.soFar', { distance: formatKm(route.km, languageTag) })}</span>}
      {!finished && route.remainingKm !== undefined && <span>{t('map.toGo', { distance: formatKm(route.remainingKm, languageTag) })}</span>}
      {route.countries.length > 1 && <span>{t('map.countries.many', { count: route.countries.length })}</span>}
    </p>}
  </div>;
}

/** The whole map, over the parcel: the journey on a globe, or the last mile up close. */
export function ParcelMapSheet({ route, stage, brand, onClose }: {
  route: Route;
  stage?: Stage;
  /** The carrier colours, so the parcel's own accent marks where it is now. */
  brand: CSSProperties;
  onClose: () => void;
}) {
  const { t, languageTag } = useI18n();
  const close = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const dialog = useModalDialog<HTMLDivElement>(true, onClose, close);
  const [time] = useState(() => new Date());
  const [chosen, setChosen] = useState<MapMode | null>(null);
  const [free, setFree] = useState(false);
  const [recenter, setRecenter] = useState(0);
  const [insets, setInsets] = useState({ top: 64, right: 0, bottom: 220, left: 0 });
  const mode = chosen ?? defaultMode(route, stage);
  const label = useRouteLabel(route);

  // The summary sits along the bottom on a phone and beside the map on a wide screen;
  // either way the route is framed in the space it leaves.
  useEffect(() => {
    const element = bar.current;
    const sheet = dialog.current;
    if (!element || !sheet || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const docked = element.offsetWidth < sheet.offsetWidth * .6;
      const next = docked
        ? { top: 24, right: 24, bottom: 24, left: element.offsetLeft + element.offsetWidth + 24 }
        : { top: 64, right: 0, bottom: sheet.offsetHeight - element.offsetTop + 12, left: 0 };
      setInsets((previous) => previous.top === next.top && previous.bottom === next.bottom && previous.left === next.left ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [dialog]);

  function change(next: MapMode) {
    if (next === mode) setRecenter((count) => count + 1);
    setChosen(next);
  }

  return createPortal(<div className="parcel-map" ref={dialog} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} style={brand}>
    <WorldMap route={route} mode={mode} time={time} night interactive sites label={label} languageTag={languageTag} insets={insets}
      live={travelling(stage)}
      recenter={recenter} onFreeChange={setFree} className="parcel-map__map" />
    <button ref={close} type="button" className="parcel-map__close" onClick={onClose} aria-label={t('map.close')}>
      <Icon name="close" />
    </button>
    <div className="parcel-map__bar" ref={bar}>
      <RouteSummary route={route} stage={stage} />
      {/* With every place close by there is only one view: no buttons, even once the map is moved. */}
      {hasNearView(route) && <div className="parcel-map__views" role="group" aria-label={t('map.view')}>
        <button type="button" aria-pressed={mode === 'journey' && !free} onClick={() => change('journey')}>
          <Icon name="globe" /><span>{t('map.journey')}</span>
        </button>
        <button type="button" aria-pressed={mode === 'now' && !free} onClick={() => change('now')}>
          <Icon name="location" /><span>{t('map.nearby')}</span>
        </button>
      </div>}
    </div>
  </div>, document.body);
}
