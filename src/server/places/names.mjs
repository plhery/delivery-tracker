// Place-name keys shared by the gazetteer generator and the server lookup, so
// both sides spell every name the same way. Plain JavaScript on purpose: the
// generator runs in Node without a TypeScript build.

const letters = { ß: 'ss', æ: 'ae', Æ: 'ae', ø: 'o', Ø: 'o', œ: 'oe', Œ: 'oe', ł: 'l', Ł: 'l', đ: 'd', Đ: 'd', ı: 'i', þ: 'th', ð: 'd' };
const german = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'ae', Ö: 'oe', Ü: 'ue' };

/**
 * Lower case, no accents, words separated by single spaces:
 * "Zürich" and "ZURICH" both become "zurich", "St. Gallen" becomes "st gallen".
 * @param {string} name
 * @returns {string}
 */
export function nameKey(name) {
  return name
    .replace(/[ßæÆøØœŒłŁđĐıþð]/g, (letter) => letters[/** @type {keyof typeof letters} */ (letter)])
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Every key a name answers to, including the German transliteration carriers
 * print in capitals ("ZUERICH", "KOELN") and each half of a bilingual name
 * ("Biel/Bienne").
 * @param {string} name
 * @returns {string[]}
 */
export function nameKeys(name) {
  const keys = new Set([nameKey(name), nameKey(name.replace(/[äöüÄÖÜ]/g, (letter) => german[/** @type {keyof typeof german} */ (letter)]))]);
  if (name.includes('/')) for (const part of name.split('/')) keys.add(nameKey(part));
  keys.delete('');
  return [...keys];
}
