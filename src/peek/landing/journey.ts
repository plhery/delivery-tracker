import type { Translate } from '../../i18n';
import type { CarrierId, Stage } from '../../types';

/**
 * The journey the landing tells: one fictional parcel, four scans, from the
 * shop in Hamburg to a mailbox in Zürich.
 */
export const JOURNEY_CARRIER: CarrierId = 'dhl';

export interface JourneyScan {
  stage: Stage;
  place: 'hamburg' | 'basel' | 'zurich';
  /** What the card says: its headline, and what is known about the arrival. */
  headline(t: Translate): string;
  detail(t: Translate): string;
  /** The notification that drops in with the scan: its title, and what follows the parcel's name. */
  ping(t: Translate, carrier: string): string;
  pingDetail(t: Translate): string;
}

const WINDOW = '13:00–17:00';

export const JOURNEY: readonly JourneyScan[] = [
  {
    stage: 'accepted', place: 'hamburg',
    headline: (t) => t('stage.in_transit'), detail: (t) => t('landing.journey.inTwoDays'),
    ping: (t, carrier) => t('landing.ping.collected', { carrier }), pingDetail: () => 'Hamburg, 17:48',
  },
  {
    stage: 'customs', place: 'basel',
    headline: (t) => t('landing.journey.cleared'), detail: (t) => t('landing.journey.tomorrow'),
    ping: (t) => t('landing.journey.cleared'), pingDetail: () => 'Basel, 23:05',
  },
  {
    stage: 'out_for_delivery', place: 'zurich',
    headline: (t) => t('stage.out_for_delivery'), detail: (t) => `${t('time.today')}, ${WINDOW}`,
    ping: (t) => t('stage.out_for_delivery'), pingDetail: (t) => `${t('time.today')}, ${WINDOW}`,
  },
  {
    stage: 'delivered', place: 'zurich',
    headline: (t) => t('stage.delivered'), detail: (t) => t('landing.journey.mailbox', { time: '14:12' }),
    ping: (t) => t('stage.delivered'), pingDetail: (t) => `${t('landing.ping.mailbox')}, 14:12`,
  },
];

/** The frame for someone who asked for less motion: the parcel on the last mile, its route drawn, its ping in place. */
export const STILL_SCAN = 2;
/** The scan that ends the journey: the pulse stops, the box opens, and a stamp lands in the passport. */
export const DELIVERED_SCAN = JOURNEY.length - 1;
