import 'server-only';

import { activeTrackingCarrierId, carrierInfo, deliveringCarrierId, displayedCarrierId, type CarrierInfo } from '../../lib/carriers';
import { isLocale, type Locale } from '../../lib/locale';
import { languageTags, translateMessage, type Translate } from '../../lib/messages';
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
  // Cut like a push title, and kept on one line: the name is also the subject.
  const name = notificationText(String(input.parcel.label ?? '').replace(/\p{Cc}/gu, ' '), 80);
  const named = (carrier: CarrierInfo) => UNNAMED_CARRIERS.has(carrier.id) ? null : carrier;
  // The sentence names who brought it to the door, even one its first carrier named and nobody followed; the card
  // keeps the carrier the app marks the parcel with.
  const deliverer = named(carrierInfo(deliveringCarrierId(parcel) ?? activeTrackingCarrierId(parcel), locale));
  const marked = named(carrierInfo(displayedCarrierId(parcel), locale));
  const when = deliveredWhen(parcel, { known: input.deliveredTime, timezone: input.timezone, now: input.now, languageTag });

  let card: DeliveryCard | null = null;
  try {
    card = await draw({ parcel, carrier: marked, when: cornerTime(when, t, languageTag), timed: 'time' in when, t, languageTag });
  } catch (error) {
    // The email is worth sending without its picture.
    logOperationalEvent('delivery_email_card_failed', { package_id: parcel.id, error_type: errorType(error) }, 'warning');
  }

  const words: EmailWords = {
    lang: locale,
    subject: name ? t('email.delivered.subject', { name }) : t('email.delivered.subjectUnnamed'),
    brand: t('app.title'),
    tagline: t('app.tagline'),
    title: name ? t('email.delivered.title', { name }) : t('email.delivered.titleUnnamed'),
    sentence: t(`email.delivered.${deliverer ? 'by' : 'line'}.${when.kind}`, {
      carrier: deliverer?.name ?? '', time: 'time' in when ? when.time : '', date: 'date' in when ? when.date : '',
    }),
    cardAlt: !card ? null : card.ends ? t('map.label', card.ends) : card.mapped ? t('email.delivered.cardAlt') : t('stage.delivered'),
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
 * The email that says a parcel was delivered: subject, plain text, HTML and the map card.
 *
 * It names the parcel as its owner named it and the carrier, and says when.
 * It never carries the tracking number, the recipient, an address or a pickup
 * code, and none of the carrier's own scan text, which can hold any of them.
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
