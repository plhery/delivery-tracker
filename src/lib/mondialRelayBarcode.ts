/** Mondial Relay label specification v2.4, pages 5–7 (July 2024).
 * https://storage.mondialrelay.fr/etiquette-mondial-relay-v-24.pdf
 * Brand(2), shipment(8), sequence(2), count(2), check(1), routing(10), check(1).
 */
export function isValidMondialRelayBarcode(value: string): boolean {
  if (!/^\d{26}$/.test(value)) return false;
  const check = (digits: string) => {
    const sum = [...digits].reverse().reduce((total, digit, i) => total + Number(digit) * (2 + i % 6), 0);
    const remainder = 11 - sum % 11;
    return String(remainder >= 10 ? 0 : remainder);
  };
  const sequence = Number(value.slice(10, 12));
  const count = Number(value.slice(12, 14));
  return sequence > 0 && sequence <= count
    && check(value.slice(0, 14)) === value[14] && check(value.slice(15, 25)) === value[25];
}
