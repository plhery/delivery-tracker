import 'server-only';

import { activeTrackingCarrierId, carrierInfo, deliveringCarrierId, displayedCarrierId, type CarrierInfo } from '../../lib/carriers';
import { documentLanguage, isLocale, type Locale } from '../../lib/locale';
import { languageTags, translateMessage, type Translate } from '../../lib/messages';
import { pickupPoint, pickupPointMapsUrl, type PickupPoint } from '../../lib/pickupPoint';
import { collectedFromPickupPoint } from '../../lib/stages';
import { SOURCE_URL } from '../../lib/source';
import { capitalized } from '../../peek/parcel/summary';
import { toParcel } from '../../store/apiRepo';
import { errorType, logOperationalEvent } from '../observability';
import { notificationText } from '../push';
import { messagesFor } from '../requestLocale';
import type { DeliveryCard, DeliveryCardInput } from './card';
import { deliveredWhen, type DeliveredWhen } from './delivered';
import { emailHtml, emailText, type EmailWords } from './html';
import type { DeliveryEmailContent, DeliveryEmailInput } from './types';

/** Carriers that stand for "nobody knows which": the email names none of them. */
const UNNAMED_CARRIERS = new Set(['unknown', 'intl-post']);

/** A link the email may carry: an address on the web. */
function webAddress(value: string, name: string): URL {
  const url = URL.canParse(value) ? new URL(value) : null;
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) throw new TypeError(`${name} must be an http(s) address`);
  return url;
}

/** When the parcel arrived, as the card's corner writes it: the sentence's own day, and the same clock. */
function cornerTime(when: DeliveredWhen, t: Translate, languageTag: string): string | null {
  switch (when.kind) {
    case 'today': return `${capitalized(t('time.today'), languageTag)}, ${when.time}`;
    case 'yesterday': return `${capitalized(t('time.yesterday'), languageTag)}, ${when.time}`;
    case 'date': return `${when.date}, ${when.time}`;
    case 'day': return when.date;
    default: return null;
  }
}

/** Where a parcel waits, in the app's own words; a map app is told the place, and nothing else. */
function placeWords(place: PickupPoint, t: Translate): NonNullable<EmailWords['place']> {
  const label = t('detail.pickupPoint');
  const link = t(place.address ? 'detail.pickupDirections' : 'detail.pickupShowOnMap');
  const url = pickupPointMapsUrl(place, false);
  return {
    label, name: place.name, address: place.address, link, url,
    text: [
      t('email.pickup.textLine', { label, value: [place.name, place.address].filter(Boolean).join(', ') }),
      t('email.pickup.textLine', { label: link, value: url }),
    ],
  };
}

/** Draws the card. The picture's code, and the world it draws, load with the first email that needs them. */
async function drawCard(input: DeliveryCardInput): Promise<DeliveryCard> {
  const { deliveryCard } = await import('./card');
  return deliveryCard(input);
}

/** The email for one parcel. `draw` makes its picture: the example keeps the one it drew. */
async function emailContent(input: DeliveryEmailInput, draw = drawCard): Promise<DeliveryEmailContent> {
  // An account may carry a language the app has since dropped, or never had.
  const locale = isLocale(input.locale) ? input.locale : 'en';
  const messages = messagesFor(locale);
  const t: Translate = (key, variables) => translateMessage(locale, key, variables, messages);
  const languageTag = languageTags[locale];
  const journeyUrl = webAddress(input.journeyUrl, 'journeyUrl');
  webAddress(input.offUrl, 'offUrl');

  const parcel = toParcel(input.parcel);
  const stage = input.stage ?? 'delivered';
  // The message's own words: the rest of the email is the same for all three. A delivered parcel whose last movement
  // made it ready for pickup was collected there, as the app says; one taken back out for delivery was brought to the door.
  const told = stage === 'ready_for_pickup' ? 'pickup' : collectedFromPickupPoint(parcel.events) ? 'collected' : 'delivered';
  // Cut like a push title, and kept on one line: the name is also the subject.
  const name = notificationText(String(input.parcel.label ?? '').replace(/\p{Cc}/gu, ' '), 80);
  const named = (carrier: CarrierInfo) => UNNAMED_CARRIERS.has(carrier.id) ? null : carrier;
  // The sentence names who brought it to the door or the pickup point, even one its first carrier named and nobody
  // followed; the card keeps the carrier the app marks the parcel with, and under it the one it was handed to, as the
  // app's card does.
  const handedTo = deliveringCarrierId(parcel);
  const deliverer = named(carrierInfo(handedTo ?? activeTrackingCarrierId(parcel), locale));
  const marked = named(carrierInfo(displayedCarrierId(parcel), locale));
  const delivery = handedTo ? named(carrierInfo(handedTo, locale)) : null;
  const when = deliveredWhen(parcel, { stage, known: input.deliveredTime, timezone: input.timezone, now: input.now, languageTag });
  const waitsAt = stage === 'ready_for_pickup' ? pickupPoint(parcel.pickupPoint) : null;

  let card: DeliveryCard | null = null;
  try {
    card = await draw({ parcel, carrier: marked, delivery, when: cornerTime(when, t, languageTag), timed: 'time' in when, t, languageTag, stage });
  } catch (error) {
    // The email is worth sending without its picture.
    logOperationalEvent('delivery_email_card_failed', { package_id: parcel.id, error_type: errorType(error) }, 'warning');
  }

  const words: EmailWords = {
    lang: documentLanguage(locale),
    subject: name ? t(`email.${told}.subject`, { name }) : t(`email.${told}.subjectUnnamed`),
    brand: t('app.title'),
    tagline: t('app.tagline'),
    title: name ? t(`email.${told}.title`, { name }) : t(`email.${told}.titleUnnamed`),
    // Whoever collected it, the carrier did not bring it: its sentence names nobody.
    sentence: t(told === 'collected' || !deliverer ? `email.${told}.line.${when.kind}` : `email.${told}.by.${when.kind}`, {
      carrier: deliverer?.name ?? '', time: 'time' in when ? when.time : '', date: 'date' in when ? when.date : '',
    }),
    place: waitsAt && placeWords(waitsAt, t),
    cardAlt: !card ? null : card.ends ? t('map.label', card.ends) : card.mapped ? t('email.delivered.cardAlt') : t(`stage.${stage}`),
    button: t('email.delivered.button'),
    footer: t('email.delivered.footer', { setting: t('email.setting.title') }),
    footerOff: t('email.delivered.footerOff'),
    footerAlerts: t('email.delivered.footerAlerts'),
    privacy: t('auth.privacyLink'),
    source: 'GitHub',
    textJourney: t('email.delivered.textJourney', { url: input.journeyUrl }),
    textOff: t('email.delivered.textOff', { url: input.offUrl }),
    journeyUrl: input.journeyUrl,
    offUrl: input.offUrl,
    privacyUrl: `${journeyUrl.origin}/privacy.html`,
    sourceUrl: SOURCE_URL,
  };
  return {
    subject: words.subject,
    text: emailText(words),
    html: emailHtml(words),
    card: card?.png ?? null,
  };
}

/**
 * The email that says a parcel was delivered, was collected from its pickup
 * point, or is ready to collect: subject, plain text, HTML and the map card.
 *
 * It names the parcel as its owner named it and, unless it was collected, the
 * carrier, and says when; a parcel ready to collect, the pickup point the
 * carrier gave. It never carries the tracking number, the recipient, their
 * address or a pickup code, and none of the carrier's own scan text, which can
 * hold any of them.
 */
export async function deliveryEmailContent(input: DeliveryEmailInput): Promise<DeliveryEmailContent> {
  return emailContent(input);
}

/** The example's card in each language: it is the same for everyone, so it is drawn once. */
const exampleCards = new Map<Locale, Promise<DeliveryCard>>();

/** The same email for a made-up parcel, for "See an example" in Settings. */
export async function exampleDeliveryEmail(locale: Locale, origin: string): Promise<DeliveryEmailContent> {
  const { EXAMPLE_NOW, EXAMPLE_TIMEZONE, exampleParcel } = await import('./example');
  // Its links lead home and to the off page without a token, which changes nothing.
  return emailContent({
    parcel: exampleParcel(locale), locale, timezone: EXAMPLE_TIMEZONE, journeyUrl: `${origin}/`, offUrl: `${origin}/email/off`, deliveredTime: 'timed', now: EXAMPLE_NOW,
  }, (input) => {
    let card = exampleCards.get(locale);
    if (!card) {
      card = drawCard(input);
      exampleCards.set(locale, card);
      // A drawing that failed is tried again by the next reader.
      card.catch(() => exampleCards.delete(locale));
    }
    return card;
  });
}
