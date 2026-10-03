import type { ApiPackageRow } from '../../generated/apiContract';
import type { Locale } from '../../lib/locale';

/** The `Content-ID` of the map card, which the HTML shows as `cid:…`. */
export const DELIVERY_CARD_CID = 'parcel-card@peek';

export interface DeliveryEmailInput {
  /** The parcel as the API gives it to its owner, with its tracking events and their places. */
  parcel: ApiPackageRow;
  locale: Locale;
  /** The IANA zone the delivery time is told in. */
  timezone: string;
  /** Opens the parcel in the app. */
  journeyUrl: string;
  /** The page that turns the account's delivery email off, with its token. */
  offUrl: string;
  /**
   * What the delivered scan knows of its time, read from the carrier's own
   * data as the push queue reads it: `timed` a clock time, `date` only a day,
   * `none` when the app noticed the delivery and the carrier gave no time.
   * Left out, the content works it out from the scan as well as it can.
   */
  deliveredTime?: DeliveredTime;
  now: Date;
}

export type DeliveredTime = 'timed' | 'date' | 'none';

export interface DeliveryEmailContent {
  subject: string;
  text: string;
  /** Shows the card as `cid:${DELIVERY_CARD_CID}` when there is one. */
  html: string;
  /** The map card as a PNG, or null when it could not be drawn. */
  card: Uint8Array | null;
}
