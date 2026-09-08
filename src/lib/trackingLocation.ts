const regionCodes = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '));
const ambiguousAddressCodes = new Set('AL AZ AR CA CO DE GA ID IL IN KY LA ME MD MA MN MS MO MT NE NC PA SC SD TN VA AG AI BE BL BS FR GE GL GR LU SG SH SO SZ TG NL NU PE SK YT SA'.split(' '));
const normalized = (value: string) => value.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
let countryNames: Map<string, string> | undefined;

export function trackingLocationCountry(location?: string): string | null {
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


/** Replace only an explicit country field; never infer a country from a city. */
export function trackingLocationLabel(location: string): string {
  const country = trackingLocationCountry(location);
  if (!country) return location;
  const flag = [...country].map((letter) => String.fromCodePoint(letter.charCodeAt(0) + 127397)).join('');
  const fields = [...location.matchAll(/[^,;|()]+/g)];
  const field = fields.filter((match) => match[0].trim()).at(-1);
  if (!field) return location;
  const start = field.index + field[0].indexOf(field[0].trim());
  const end = start + field[0].trim().length;
  return location.slice(0, start) + flag + location.slice(end);
}
