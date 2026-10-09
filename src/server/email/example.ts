import 'server-only';

import type { ApiEventPlace, ApiPackageRow, ApiStage } from '../../generated/apiContract';
import type { Locale } from '../../lib/locale';
import de from '../../../shared/demo-locales/de.json';
import es from '../../../shared/demo-locales/es.json';
import fr from '../../../shared/demo-locales/fr.json';
import it from '../../../shared/demo-locales/it.json';
import pl from '../../../shared/demo-locales/pl.json';
import pt from '../../../shared/demo-locales/pt.json';

/** The demo's own wording in each language; English is what it is written in. */
const WORDING: Record<Exclude<Locale, 'en'>, Record<string, string>> = { de, es, fr, it, pl, pt };

/** Where the example is read, and when: in Zürich, on the afternoon the parcel arrived. */
export const EXAMPLE_TIMEZONE = 'Europe/Zurich';
export const EXAMPLE_NOW = new Date('2026-01-15T15:00:00Z');

const HAMBURG: ApiEventPlace = { latitude: 53.551, longitude: 9.993, precision: 'city', country: 'DE', name: 'Hamburg' };
const REGENSDORF: ApiEventPlace = { latitude: 47.434, longitude: 8.469, precision: 'city', country: 'CH', name: 'Regensdorf' };
const ZURICH: ApiEventPlace = { latitude: 47.367, longitude: 8.55, precision: 'city', country: 'CH', name: 'Zürich' };

/** The demo's trainers, from a shop in Hamburg to a letterbox in Zürich at 14:12, told in the demo's words. */
const SCANS: readonly { stage: ApiStage; at: string; description: string; place?: ApiEventPlace }[] = [
  { stage: 'registered', at: '2026-01-13T09:02:00+00:00', description: 'Your running shoes are packed' },
  { stage: 'accepted', at: '2026-01-13T16:48:00+00:00', description: 'Collected from the running shop', place: HAMBURG },
  { stage: 'in_transit', at: '2026-01-14T20:40:00+00:00', description: 'Arrived at the destination depot', place: REGENSDORF },
  { stage: 'out_for_delivery', at: '2026-01-15T07:05:00+00:00', description: 'With the courier for delivery', place: ZURICH },
  { stage: 'delivered', at: '2026-01-15T13:12:00+00:00', description: 'Delivered to your letterbox', place: ZURICH },
];

/** The made-up parcel of "See an example": nobody's, with no number, and the same for every reader of a language. */
export function exampleParcel(locale: Locale): ApiPackageRow {
  const words = (text: string) => locale === 'en' ? text : WORDING[locale][text] ?? text;
  const id = '00000000-0000-4000-8000-000000000000';
  return {
    id,
    tracking_number: '',
    label: words('New trainers 👟'),
    carrier: 'dhl',
    created_at: SCANS[0].at,
    expected_delivery: null,
    last_status_text: null,
    last_synced_at: SCANS.at(-1)!.at,
    sync_status: 'ok',
    sync_error: null,
    tracking_url: null,
    dpd_postcode: null,
    carrier_data: { destination_country: 'CH' },
    archived_at: null,
    notifications_muted: false,
    tracking_events: SCANS.map(({ stage, at, description, place }, index) => ({
      id: `${id.slice(0, -1)}${index + 1}`,
      package_id: id,
      stage,
      description: words(description),
      location: null,
      occurred_at: at,
      place: place ?? null,
    })),
  };
}
