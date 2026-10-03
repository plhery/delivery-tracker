import 'server-only';

import { DELIVERY_CARD_CID } from './types';

/** What a delivery email says, in the reader's language, before it is laid out. */
export interface EmailWords {
  /** The language code for the document's `lang`. */
  lang: string;
  subject: string;
  /** "Peek" and its tagline: the header, and the start of the last line. */
  brand: string;
  tagline: string;
  title: string;
  sentence: string;
  /** What the card's picture shows, for a reader who does not see it. Null when there is no picture. */
  cardAlt: string | null;
  button: string;
  /** The footer sentence around its two links: `{{off}}` and `{{alerts}}` stand where they go. */
  footer: string;
  footerOff: string;
  footerAlerts: string;
  /** The labels of the last line's two links. */
  privacy: string;
  source: string;
  /** What plain text says in place of the button and of the way out, each with its address. */
  textJourney: string;
  textOff: string;
  journeyUrl: string;
  offUrl: string;
  privacyUrl: string;
  sourceUrl: string;
}

/** The light theme's colours: an email has no style sheet to take them from. */
const COLOR = { ground: '#eceee7', canvas: '#f4f5f1', ink: '#20251e', soft: '#657060', yellow: '#f3cf48' };
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
/** The column's width, and the card's inside it. */
const COLUMN = 520;
const CARD = 456;

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text as HTML text, or as an attribute's value. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ENTITIES[character]);
}

/** The system's typeface in one of the theme's colours: mail clients do not hand a font down into a table. */
const type = (color: string = COLOR.ink) => `font-family: ${FONT}; color: ${color}`;
const link = (url: string, label: string, color: string) => `<a href="${escapeHtml(url)}" style="color: ${color}; text-decoration: underline">${escapeHtml(label)}</a>`;

/** The footer sentence with its two links in place of their markers. */
function footerHtml(words: EmailWords): string {
  return words.footer.split(/(\{\{(?:off|alerts)\}\})/).map((part) => part === '{{off}}' ? link(words.offUrl, words.footerOff, COLOR.ink)
    : part === '{{alerts}}' ? link(words.journeyUrl, words.footerAlerts, COLOR.ink) : escapeHtml(part)).join('');
}

/**
 * The email as mail clients render it: tables for the frame, every style
 * inline, the system's own typeface, and nothing fetched from anywhere. The
 * card is the only picture, attached to the message and shown by its
 * `Content-ID`; the header is text. Whatever comes from the parcel or its
 * carrier is escaped.
 *
 * The column is 520 px at most and as wide as a phone lets it be. Its side
 * margins are cells of their own, so they shrink with it and the card keeps
 * as much of a small screen as it can.
 */
export function emailHtml(words: EmailWords): string {
  const table = 'role="presentation" cellspacing="0" cellpadding="0" border="0"';
  const gutter = '<td width="6%" style="font-size: 0; line-height: 0">&nbsp;</td>';
  // The picture's rounded corners are cut out of it, and it leads where the button leads.
  const card = words.cardAlt === null ? '' : `
<div style="margin: 22px 0 0"><a href="${escapeHtml(words.journeyUrl)}" style="text-decoration: none"><img src="cid:${DELIVERY_CARD_CID}" width="${CARD}" alt="${escapeHtml(words.cardAlt)}" style="display: block; width: 100%; max-width: ${CARD}px; height: auto; border: 0; outline: none; ${type(COLOR.soft)}; font-size: 13px; line-height: 1.5"></a></div>`;
  return `<!doctype html>
<html lang="${escapeHtml(words.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<title>${escapeHtml(words.subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${COLOR.ground}; -webkit-text-size-adjust: 100%; text-size-adjust: 100%">
<div style="display: none; max-height: 0; max-width: 0; overflow: hidden; opacity: 0; font-size: 1px; line-height: 1px; color: ${COLOR.ground}; mso-hide: all">${escapeHtml(words.sentence)}</div>
<table ${table} width="100%" bgcolor="${COLOR.ground}" style="background-color: ${COLOR.ground}">
<tr>
<td align="center" style="padding: 24px 12px">
<!--[if mso]><table ${table} width="${COLUMN}" align="center"><tr><td><![endif]-->
<table ${table} width="100%" style="max-width: ${COLUMN}px">
<tr>
<td bgcolor="${COLOR.canvas}" style="border-radius: 24px; background-color: ${COLOR.canvas}">
<table ${table} width="100%">
<tr>
${gutter}
<td width="88%" align="left" style="padding: 32px 0; ${type()}; font-size: 15px; line-height: 1.5">
<p style="margin: 0; ${type()}; font-size: 16px; line-height: 1.1; font-weight: 700; letter-spacing: -.4px">${escapeHtml(words.brand)}</p>
<p style="margin: 2px 0 0; ${type(COLOR.soft)}; font-size: 10px; line-height: 1.1">${escapeHtml(words.tagline)}</p>
<h1 style="margin: 26px 0 6px; ${type()}; font-size: 30px; line-height: 1.1; font-weight: 600; letter-spacing: -1px">${escapeHtml(words.title)}</h1>
<p style="margin: 0; ${type(COLOR.soft)}; font-size: 14px; line-height: 1.5">${escapeHtml(words.sentence)}</p>${card}
<table ${table} style="margin: 20px 0 0">
<tr>
<td bgcolor="${COLOR.yellow}" style="border-radius: 16px; background-color: ${COLOR.yellow}"><a href="${escapeHtml(words.journeyUrl)}" style="display: inline-block; padding: 15px 20px; border-radius: 16px; ${type()}; font-size: 15px; line-height: 20px; font-weight: 600; text-decoration: none">${escapeHtml(words.button)}</a></td>
</tr>
</table>
<p style="margin: 26px 0 0; ${type(COLOR.soft)}; font-size: 12px; line-height: 1.6">${footerHtml(words)}</p>
<p style="margin: 10px 0 0; ${type(COLOR.soft)}; font-size: 11.5px; line-height: 1.6">${escapeHtml(words.brand)} · ${escapeHtml(words.tagline)} · ${link(words.privacyUrl, words.privacy, COLOR.soft)} · ${link(words.sourceUrl, words.source, COLOR.soft)}</p>
</td>
${gutter}
</tr>
</table>
</td>
</tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td>
</tr>
</table>
</body>
</html>
`;
}

/**
 * The same email for a client that shows no HTML: the title, the sentence and
 * the way to the journey, then why it came, how to stop it, and the two
 * addresses its last line links.
 */
export function emailText(words: EmailWords): string {
  return [
    words.title,
    words.sentence,
    words.textJourney,
    '',
    words.footer.replace('{{off}}', words.footerOff).replace('{{alerts}}', words.footerAlerts),
    words.textOff,
    '',
    `${words.brand} · ${words.tagline}`,
    `${words.privacy}: ${words.privacyUrl}`,
    `${words.source}: ${words.sourceUrl}`,
    '',
  ].join('\n');
}
