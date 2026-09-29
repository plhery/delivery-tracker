import { geoDistance } from 'd3-geo';
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
  /** Kilometres between the scans so far, when at least two have places. */
  km: number | null;
  /** The name without a trailing emoji, and that emoji. */
  title: string;
  emoji: string | null;
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

const EARTH_KM = 6371;

/** A name whose last character is an emoji gives that emoji up for the stamp. */
export function splitEmoji(label: string): { title: string; emoji: string | null } {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(label.trim())].map((part) => part.segment);
  const last = graphemes.at(-1);
  if (!last || !/\p{Extended_Pictographic}/u.test(last)) return { title: label, emoji: null };
  return { title: graphemes.slice(0, -1).join('').trim(), emoji: last };
}

export function stampFacts(parcel: ParcelWithEvents, name: string, carrierName: string, languageTag: string, t: Translate): StampFacts {
  const current = currentEvent(parcel.events);
  const newest = sortEventsDesc(parcel.events);
  const placed = newest.filter((event) => event.place);
  const latest = placed[0];
  const origin = placed.at(-1)?.place?.country ?? '';
  let km = 0;
  for (let index = 1; index < placed.length; index++) {
    const [a, b] = [placed[index].place!, placed[index - 1].place!];
    km += geoDistance([a.longitude, a.latitude], [b.longitude, b.latitude]) * EARTH_KM;
  }
  const at = new Date(current?.occurredAt ?? parcel.createdAt);
  const country = latest?.place ? countryName(latest.place.country, languageTag) : '';
  const upper = (text: string) => text.toLocaleUpperCase(languageTag);
  const { title, emoji } = splitEmoji(name);
  return {
    stage: current?.stage ?? null,
    icon: parcelIcon(current?.stage),
    delivered: current?.stage === 'delivered',
    place: upper(latest?.place?.precision === 'city' ? latest.place.name : carrierName),
    country: upper(country.length > 12 ? latest!.place!.country : country),
    origin,
    originName: STAMP_NAMES[origin] ?? origin,
    international: new Set(placed.map((event) => event.place!.country)).size > 1,
    km: km >= 5 ? Math.round(km / 10) * 10 : null,
    title, emoji,
    message: current ? localizedEventDescription(current.description, t) : '',
    messagePlace: current?.place?.precision === 'city' ? current.place.name : current?.location ?? '',
    date: new Intl.DateTimeFormat(languageTag, { day: '2-digit', month: '2-digit', year: '2-digit' }).format(at),
    dayMonth: new Intl.DateTimeFormat(languageTag, { day: '2-digit', month: '2-digit' }).format(at),
    time: new Intl.DateTimeFormat(languageTag, { hour: '2-digit', minute: '2-digit' }).format(at),
  };
}
