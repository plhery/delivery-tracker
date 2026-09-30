/** PostLogistics' eight-digit reference and three-digit suffix are separated by a dash. */
export function postlogisticsIdentifier(raw: string): string {
  const value = raw.trim();
  return /^\d{11}$/.test(value)
    ? `${value.slice(0, 8)}-${value.slice(8)}`
    : value;
}
