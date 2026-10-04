import 'server-only';
import { carrierInfo, displayedCarrierId, type CarrierInfo } from '../lib/carriers';
import type { Locale } from '../lib/locale';
import { languageTags, translateMessage, type Translate } from '../lib/messages';
import { parcelHasCarrierUpdate } from '../lib/parcelStatus';
import { stageMeta } from '../lib/stages';
import { parcelLinkView } from '../peek/linkModel';
import { giftPreviewText, parcelPreviewText, parcelStage, type Wording } from '../peek/parcel/summary';
import { SAMPLE_LINK_ID } from '../peek/sample';
import { sampleParcel } from '../peek/sampleLink';
import { clientIp, clientNetwork } from './api';
import { captureOperationalError } from './observability';
import { isParcelLinkId, viewerParcel } from './publicParcels';
import { RateLimiter } from './rateLimit';
import { messagesFor } from './requestLocale';
import { serviceClient } from './runtime';

const limiter = new RateLimiter();

/**
 * What a parcel link's preview says: its status, its carrier and when it
 * arrives. Never the tracking number, a name or a place. A gift on its way
 * says less: that something is coming, and when.
 */
export interface ParcelLinkPreview {
  /** "Out for delivery · DHL", or "Something’s on its way to you" for a gift. */
  title: string;
  /** "Today, 13:00–17:00. Follow it on Peek." */
  description: string;
  headline: string;
  detail: string | null;
  /** Null while no carrier is known for the number, and for a gift on its way. */
  carrier: CarrierInfo | null;
  /** How many of the six steps are done, for the image's track. */
  steps: number;
  /** A gift on its way: the picture is wrapped too. */
  gift?: boolean;
  /** What the picture says of a parcel nobody sent: the sample's note. */
  note?: string;
}

/** The words a preview is written in. */
function wordingIn(locale: Locale, now: number): Wording & { now: number } {
  const messages = messagesFor(locale);
  const t: Translate = (key, variables) => translateMessage(locale, key, variables, messages);
  return { t, languageTag: languageTags[locale], now };
}

/** The sample parcel's preview: its story's beginning, and the note that nothing in it is real. */
function samplePreview(locale: Locale, now: number): ParcelLinkPreview {
  const wording = wordingIn(locale, now);
  const { t } = wording;
  const parcel = sampleParcel(now);
  const carrier = carrierInfo(displayedCarrierId(parcel), locale);
  const stage = parcelStage(parcel);
  const note = t('sample.note');
  return {
    ...parcelPreviewText(parcel, carrier.name, wording),
    // The page's title and description say what it is, not what the made-up parcel does.
    title: `${t('app.title')} — ${note}`,
    description: `${t('sample.yours.title')} ${t('landing.lead')}`,
    carrier,
    steps: stage ? stageMeta(stage).progress + 1 : 0,
    note,
  };
}

/**
 * Reads a parcel for its link preview, as a viewer would see it and without
 * recording that the link was opened. An unknown, forgotten, stopped or
 * malformed link, a refused client and a failing database all answer null:
 * the preview is then Peek's own. The sample's preview is told here, with
 * no database.
 */
export async function parcelLinkPreview(linkId: unknown, headers: Headers, locale: Locale, now = Date.now()): Promise<ParcelLinkPreview | null> {
  if (linkId !== SAMPLE_LINK_ID && !isParcelLinkId(linkId)) return null;
  // The page and its image share one allowance per client.
  if (limiter.retryAfter(`parcel-link-preview:${clientNetwork(clientIp({ headers }))}`, { limit: 60, window: 60 })) return null;
  if (linkId === SAMPLE_LINK_ID) return samplePreview(locale, now);
  try {
    const client = serviceClient();
    const found = client ? await viewerParcel(client, linkId) : null;
    if (found?.status !== 'shown') return null;
    const { parcel } = parcelLinkView(found.parcel);
    const wording = wordingIn(locale, now);
    const { t } = wording;
    const stage = parcelStage(parcel);
    const steps = stage ? stageMeta(stage).progress + 1 : 0;
    // A gift on its way names no carrier: who carries it can tell where it comes from.
    if (found.wrappedGift) return { ...giftPreviewText(parcel, wording), carrier: null, steps, gift: true };
    const known = parcel.carrier !== 'unknown' || parcelHasCarrierUpdate(parcel);
    const carrier = known ? carrierInfo(displayedCarrierId(parcel), locale) : null;
    return { ...parcelPreviewText(parcel, carrier?.name ?? t('app.title'), wording), carrier, steps };
  } catch (error) {
    captureOperationalError(error, { component: 'parcel-links', operation: 'link-preview' });
    return null;
  }
}
