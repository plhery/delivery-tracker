import type { IconName } from '../../components/Icon';
import { localizedEventDescription, type Translate } from '../../i18n';
import { parcelIcon } from '../../lib/parcelDesign';
import { currentEvent, sortEventsDesc } from '../../lib/stages';
import { countryName } from '../../lib/trackingLocation';
import type { ParcelWithEvents, Stage } from '../../types';

/** Everything a stamp, a postmark or a card may print about one parcel. */
export interface StampFacts {
  stage: Stage | null;
  icon: IconName;
  delivered: boolean;
  /** The last scan's town, or the carrier's name before any scan has a place. */
  place: string;
  /** The last scan's country, spelled out when it fits a ring. */
  country: string;
  /** The country code of the first place the parcel was scanned. */
  origin: string;
  /** That country as its own stamps name it: HELVETIA, DEUTSCHLAND, NIPPON. */
  originName: string;
  /** Whether the parcel has crossed a border. */
  international: boolean;
  /** The last scan, as the carrier worded it, and where. */
  message: string;
  messagePlace: string;
  date: string;
  dayMonth: string;
  time: string;
}

/** How stamps name their own country. Others fall back to the code. */
const STAMP_NAMES: Record<string, string> = {
  AT: 'ÖSTERREICH', BE: 'BELGIQUE', CH: 'HELVETIA', CN: 'CHINA', CZ: 'ČESKO', DE: 'DEUTSCHLAND', DK: 'DANMARK',
  ES: 'ESPAÑA', FI: 'SUOMI', FR: 'FRANCE', GB: 'UK', IT: 'ITALIA', JP: 'NIPPON', LI: 'LIECHTENSTEIN',
  NL: 'NEDERLAND', NO: 'NORGE', PL: 'POLSKA', PT: 'PORTUGAL', SE: 'SVERIGE', US: 'USA',
};

export function stampFacts(parcel: ParcelWithEvents, carrierName: string, languageTag: string, t: Translate): StampFacts {
  const current = currentEvent(parcel.events);
  const newest = sortEventsDesc(parcel.events);
  const placed = newest.filter((event) => event.place);
  const latest = placed[0];
  const origin = placed.at(-1)?.place?.country ?? '';
  const at = new Date(current?.occurredAt ?? parcel.createdAt);
  const country = latest?.place ? countryName(latest.place.country, languageTag) : '';
  const upper = (text: string) => text.toLocaleUpperCase(languageTag);
  return {
    stage: current?.stage ?? null,
    icon: parcelIcon(current?.stage),
    delivered: current?.stage === 'delivered',
    place: upper(latest?.place?.precision === 'city' ? latest.place.name : carrierName),
    country: upper(country.length > 12 ? latest!.place!.country : country),
    origin,
    originName: STAMP_NAMES[origin] ?? origin,
    international: new Set(placed.map((event) => event.place!.country)).size > 1,
    message: current ? localizedEventDescription(current.description, t) : '',
    messagePlace: current?.place?.precision === 'city' ? current.place.name : current?.location ?? '',
    date: new Intl.DateTimeFormat(languageTag, { day: '2-digit', month: '2-digit', year: '2-digit' }).format(at),
    dayMonth: new Intl.DateTimeFormat(languageTag, { day: '2-digit', month: '2-digit' }).format(at),
    time: new Intl.DateTimeFormat(languageTag, { hour: '2-digit', minute: '2-digit' }).format(at),
  };
}
