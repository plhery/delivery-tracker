import 'server-only';

import type { Locale } from '../../lib/locale';
import type { DeliveryEmailContent, DeliveryEmailInput } from './types';

/** The email that says a parcel was delivered: subject, plain text, HTML and the map card. */
export async function deliveryEmailContent(input: DeliveryEmailInput): Promise<DeliveryEmailContent> {
  void input;
  throw new Error('Delivery email content is not implemented');
}

/** The same email for a made-up parcel, for "See an example" in Settings. */
export async function exampleDeliveryEmail(locale: Locale, origin: string): Promise<DeliveryEmailContent> {
  void locale;
  void origin;
  throw new Error('Delivery email content is not implemented');
}
