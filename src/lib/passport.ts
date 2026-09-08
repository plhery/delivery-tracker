import { currentStage } from './stages';
import type { ParcelWithEvents, Stage } from '../types';

const stageOrder: Stage[] = ['registered', 'accepted', 'in_transit', 'customs', 'out_for_delivery', 'failed_attempt', 'ready_for_pickup', 'delivered', 'returned'];
const regionCodes = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '));
const ambiguousAddressCodes = new Set('AL AZ AR CA CO DE GA ID IL IN KY LA ME MD MA MN MS MO MT NE NC PA SC SD TN VA AG AI BE BL BS FR GE GL GR LU SG SH SO SZ TG NL NU PE SK YT SA'.split(' '));
const normalized = (value: string) => value.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
let countryNames: Map<string, string> | undefined;

export function firstScanCountry(location?: string): string | null {
  if (!location?.trim()) return null;
  const field = location.split(/[,;|()]/).map((value) => value.trim()).filter(Boolean).at(-1);
  if (!field) return null;
  if (regionCodes.has(field)) return location.trim() === field || !ambiguousAddressCodes.has(field) ? field : null;
  if (!countryNames) {
    countryNames = new Map([['usa', 'US'], ['uk', 'GB']]);
    for (const language of ['en', 'de', 'fr', 'it']) {
      const names = new Intl.DisplayNames([language], { type: 'region' });
      for (const code of regionCodes) countryNames.set(normalized(names.of(code) ?? code), code);
    }
  }
  return countryNames.get(normalized(field)) ?? null;
}

export interface DeliveryRecord { parcelId: string; label: string; duration: number; deliveredAt: number }

/** Match iOS: the clock starts at a physical scan, never when a parcel is added. */
export function passportStatistics(parcels: readonly ParcelWithEvents[]) {
  let deliveredCount = 0;
  let activeCount = 0;
  const records: DeliveryRecord[] = [];
  const countries = new Map<string, number>();
  for (const parcel of parcels) {
    const meaningful = parcel.events.filter((event) => event.stage !== 'pending');
    const dated = meaningful.map((event) => ({ event, date: Date.parse(event.occurredAt) }))
      .filter(({ date }) => Number.isFinite(date))
      .sort((a, b) => a.date - b.date || stageOrder.indexOf(a.event.stage) - stageOrder.indexOf(b.event.stage) || a.event.id.localeCompare(b.event.id));
    const datesAreComplete = dated.length === meaningful.length;
    const stage = datesAreComplete ? dated.at(-1)?.event.stage : currentStage(parcel.events);
    if (stage === 'delivered') deliveredCount += 1;
    if (!parcel.archivedAt && stage !== 'delivered' && stage !== 'returned') activeCount += 1;
    const physical = dated.filter(({ event }) => event.stage !== 'registered');
    const first = physical[0];
    if (!datesAreComplete || !first || !['accepted', 'in_transit'].includes(first.event.stage)) continue;
    const country = firstScanCountry(first.event.location);
    if (country) countries.set(country, (countries.get(country) ?? 0) + 1);
    const completion = physical.find(({ event }) => event.stage === 'delivered');
    if (stage !== 'delivered' || !completion || completion.date <= first.date) continue;
    records.push({ parcelId: parcel.id, label: parcel.label, duration: completion.date - first.date, deliveredAt: completion.date });
  }
  records.sort((a, b) => a.duration - b.duration || a.parcelId.localeCompare(b.parcelId));
  return {
    deliveredCount, activeCount, carrierCount: new Set(parcels.map((parcel) => parcel.carrier)).size,
    durationSampleCount: records.length,
    averageDeliveryDuration: records.length ? records.reduce((sum, record) => sum + record.duration, 0) / records.length : null,
    fastestDelivery: records[0] ?? null,
    originCountries: [...countries].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
  };
}

export function formatJourneyDuration(duration: number, languageTag: string) {
  const totalMinutes = Math.max(1, Math.floor(duration / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const unit = (value: number, name: 'day' | 'hour' | 'minute') => new Intl.NumberFormat(languageTag, { style: 'unit', unit: name, unitDisplay: 'narrow' }).format(value);
  return days ? [unit(days, 'day'), hours ? unit(hours, 'hour') : ''].filter(Boolean).join(' ')
    : hours ? [unit(hours, 'hour'), minutes ? unit(minutes, 'minute') : ''].filter(Boolean).join(' ')
      : unit(totalMinutes, 'minute');
}
