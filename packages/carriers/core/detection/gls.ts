/**
 * GLS parcel number check digit.
 *
 * What it is: the check used by the `"gls"` detection rules on 12-digit
 * numbers, which are otherwise shared with FedEx, Mondial Relay, SF Express
 * and others.
 * What it is not: no carrier lookup and no provider I/O. The caller passes an
 * already-normalized number; anything else fails the digits-only shape test.
 */

/**
 * 11 digits and a modulo-10 check digit: weights 3, 1, 3, … from the right,
 * plus one (paketda.de's "Paket-Prüfziffern"; GLS ShipIT answers a 12-digit
 * number with its first 11 digits). An 11-digit number is the same parcel
 * number without its check digit and has nothing to verify.
 */
export function isValidGlsParcelNumber(value: string): boolean {
  if (!/^\d{12}$/.test(value)) return false;
  const sum = [...value.slice(0, 11)].reverse().reduce((total, digit, i) => total + Number(digit) * (i % 2 === 0 ? 3 : 1), 1);
  return (10 - (sum % 10)) % 10 === Number(value[11]);
}
