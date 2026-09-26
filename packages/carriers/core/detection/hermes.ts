/**
 * Hermes Germany legacy parcel number check digit.
 *
 * What it is: the check used by the `"hermes"` detection rule on 14-digit
 * numbers, which are otherwise shared with DPD, BRT, SEUR and others.
 * What it is not: no carrier lookup and no provider I/O. The caller passes an
 * already-normalized number; anything else fails the digits-only shape test.
 */

/**
 * 13 digits and a modulo-10 check digit, weighted 3, 1, 3, … from the left
 * (the EAN scheme). Documented by paketda.de ("Paket-Prüfziffern"); every
 * publicly reported 14-digit Hermes number in the corpus passes it.
 */
export function isValidHermesParcelNumber(value: string): boolean {
  if (!/^\d{14}$/.test(value)) return false;
  const sum = [...value.slice(0, 13)].reduce((total, digit, i) => total + Number(digit) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(value[13]);
}
