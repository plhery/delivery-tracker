/** Native product formatting shared by API requests and tracking links. */
export function normalizeCourierGuyNumber(raw: string): string {
  const number = raw.replace(/\s/g, '').toUpperCase();
  // The native client preserves this product separator. Generic input
  // normalization removes dashes, so restore only the confirmed label forms.
  const product = /^(DD|LD)-?([A-Z0-9]{6})$/.exec(number);
  if (product) return `${product[1]}-${product[2]}`;
  if (!/^[A-Z0-9]{5,40}$/.test(number)) throw new TypeError('The Courier Guy requires a shipment tracking reference');
  return number;
}

export function normalizeCourierGuyRecognitionNumber(raw: string): string {
  const number = normalizeCourierGuyNumber(raw);
  if (!/^(?:DD|LD)-[A-Z0-9]{6}$/.test(number)) throw new TypeError('The Courier Guy recognition requires a supported product reference');
  return number;
}
