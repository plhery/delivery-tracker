const regionCodes = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '));
const ambiguousAddressCodes = new Set('AL AZ AR CA CO DE GA ID IL IN KY LA ME MD MA MN MS MO MT NE NC PA SC SD TN VA AG AI BE BL BS FR GE GL GR LU SG SH SO SZ TG NL NU PE SK YT SA'.split(' '));
// Carrier spellings no region name matches. Display only: Passport evidence
// stays in step with private.passport_country, which Friends stamps use.
const carrierSpellings = new Map([
  ['united states of america', 'US'], ['great britain', 'GB'], ['czech republic', 'CZ'], ['holland', 'NL'],
  ['hong kong', 'HK'], ['macau', 'MO'], ['macao', 'MO'], ['turkey', 'TR'], ['russian federation', 'RU'],
  ['korea', 'KR'], ['republic of korea', 'KR'],
]);
// Apple's ICU (Safari, iOS) calls CN "China mainland" in every language; carriers write "China".
const chinaNames = new Map([['en', 'China'], ['de', 'China'], ['fr', 'Chine'], ['it', 'Cina'], ['es', 'China'], ['pt', 'China'], ['pl', 'Chiny']]);
// "Mexico City" is a city, not Mexico followed by one.
const settlementWords = new Set(['city', 'town', 'ville', 'stadt', 'ciudad', 'cidade', 'citta']);
const normalized = (value: string) => value.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
let countryNames: Map<string, string> | undefined;
const displayNames = new Map<string, Intl.DisplayNames>();

function namedCountry(name: string, display: boolean): string | null {
  if (!countryNames) {
    countryNames = new Map([['usa', 'US'], ['uk', 'GB']]);
    for (const language of ['en', 'de', 'fr', 'it', 'es', 'pt', 'pl']) {
      const names = new Intl.DisplayNames([language], { type: 'region' });
      for (const code of regionCodes) countryNames.set(normalized(names.of(code) ?? code), code);
    }
    for (const name of chinaNames.values()) countryNames.set(normalized(name), 'CN');
  }
  const key = normalized(name);
  const code = countryNames.get(key);
  if (code || !display) return code ?? null;
  const bare = key.replace(/^the /, '');
  return countryNames.get(bare) ?? carrierSpellings.get(bare) ?? null;
}

function fieldCountry(field: string, location: string, display: boolean): string | null {
  if (regionCodes.has(field)) return location === field || !ambiguousAddressCodes.has(field) ? field : null;
  return namedCountry(field, display);
}

/** Passport evidence: only an explicit final country field; never a country inferred from a city. */
export function trackingLocationCountry(location?: string): string | null {
  const text = location?.trim();
  const field = text?.split(/[,;|()]/).map((value) => value.trim()).filter(Boolean).at(-1);
  return field ? fieldCountry(field, text!, false) : null;
}

export interface TrackingPlace {
  /** The country the carrier wrote, as an ISO 3166-1 alpha-2 code. */
  country: string | null;
  /** The rest of the location; empty when the country was all of it. */
  place: string;
}

/**
 * For display, take an explicit country off a location: the final field ("Zürich, CH",
 * repeated in "Hebron, KY, US, US") or a leading name ("Switzerland Haerkingen").
 */
export function trackingPlace(location: string): TrackingPlace {
  const text = location.trim();
  const fields = [...text.matchAll(/[^,;|()]+/g)].filter((match) => match[0].trim());
  let country: string | null = null;
  let kept = fields.length;
  while (kept > 0) {
    const code = fieldCountry(fields[kept - 1][0].trim(), text, true);
    if (!code || (country && code !== country)) break;
    country = code;
    kept -= 1;
  }
  if (country) return { country, place: kept ? text.slice(0, fields[kept].index).replace(/[\s,;|(]+$/u, '') : '' };
  if (fields.length === 1 && text === fields[0][0]) {
    const words = text.split(/\s+/);
    for (let count = Math.min(words.length - 1, 4); count > 0; count -= 1) {
      const code = namedCountry(words.slice(0, count).join(' '), true);
      const place = words.slice(count).join(' ');
      if (code && /^\p{Lu}/u.test(place) && !settlementWords.has(normalized(place))) return { country: code, place };
    }
  }
  return { country: null, place: text };
}

export function countryFlag(code: string): string {
  return [...code].map((letter) => String.fromCodePoint(letter.charCodeAt(0) + 127397)).join('');
}

/** The region's name, with the short "Hong Kong" and "Macao" iOS also uses. */
export function countryName(code: string, languageTag: string): string {
  const china = code === 'CN' ? chinaNames.get(languageTag.split('-')[0]) : undefined;
  if (china) return china;
  const style = code === 'HK' || code === 'MO' ? 'short' : 'long';
  const key = `${languageTag}:${style}`;
  if (!displayNames.has(key)) displayNames.set(key, new Intl.DisplayNames([languageTag], { type: 'region', style }));
  return displayNames.get(key)!.of(code) ?? code;
}
