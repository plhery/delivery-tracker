import { useState } from 'react';
import { pipMood } from '../../components/map/Pip';
import { buildRoute, type Place, type Route } from '../../components/map/route';
import { WorldMap } from '../../components/map/WorldMap';
import { useI18n } from '../../i18n';
import { JOURNEY, type JourneyScan } from './journey';

const PLACES: Record<JourneyScan['place'], Place> = {
  hamburg: { id: 'hamburg', name: 'Hamburg', country: 'DE', coordinate: [9.993, 53.551], precision: 'city' },
  basel: { id: 'basel', name: 'Basel', country: 'CH', coordinate: [7.573, 47.558], precision: 'city' },
  zurich: { id: 'zurich', name: 'Zürich', country: 'CH', coordinate: [8.55, 47.367], precision: 'city' },
};

/** The route as it stands after each scan: what has been travelled, and the way still to go. */
const ROUTES: readonly Route[] = JOURNEY.map((_, scan) => buildRoute(
  JOURNEY.slice(0, scan + 1).map(({ stage, place }, index) => ({ at: `2026-01-0${index + 1}T12:00:00Z`, description: '', stage, place: PLACES[place] })),
  PLACES.zurich,
));
/** Room for the card's top row, and for the names beside the first and the last place. */
const INSETS = { top: 60, right: 32, bottom: 30, left: 18 };

/**
 * The journey on the app's own map, in the card's ink: the route as far as
 * the scan, the parcel's dot, and Pip beside it in the scan's mood. The
 * picture is framed once for the whole journey, so only the parcel moves.
 */
export default function JourneyMap({ scan }: { scan: number }) {
  const { languageTag } = useI18n();
  const [time] = useState(() => new Date());
  const { stage } = JOURNEY[scan];
  const mood = pipMood(stage);
  return <WorldMap route={ROUTES[scan]} framing={ROUTES[ROUTES.length - 1]} mode="journey" time={time} look="tint" labels="ends" context={false}
    live={stage !== 'delivered'} glide pip={mood && { mood, ceiling: 44 }} languageTag={languageTag} insets={INSETS} className="landing-journey__canvas" />;
}
