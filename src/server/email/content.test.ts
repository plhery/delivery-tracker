// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../shared/locales/en.json';
import type { ApiPackageRow, ApiTrackingEventRow } from '../../generated/apiContract';
import { SUPPORTED_LOCALES } from '../../lib/locale';
import type { MessageKey } from '../../lib/messages';
import * as observability from '../observability';
import { messagesFor } from '../requestLocale';
import type { DeliveryCard, DeliveryCardInput } from './card';
import { deliveryEmailContent, exampleDeliveryEmail } from './content';
import { DELIVERY_CARD_CID, type DeliveryEmailInput } from './types';

// The picture has tests of its own; here it is a stand-in, so the words can be read without drawing.
const drawn = vi.hoisted(() => ({ card: vi.fn() }));
vi.mock('./card', () => ({ deliveryCard: drawn.card }));

// Synthetic values only: no carrier issued this number and nobody lives there.
const trackingNumber = 'TESTPARCEL123456';
const PRIVATE = /TESTPARCEL|Alex Example|Example Kiosk|Samplestrasse|9999|4711|Example Shop|Exampletown|Signed by/;

const NOW = new Date('2026-10-03T15:00:00Z');
const JOURNEY = 'https://peek.example.test/?parcel=11111111-2222-4333-8444-555555555555';
const OFF = 'https://peek.example.test/email/off#t=made-up.not-a-real-token';
const PRIVACY = 'https://peek.example.test/privacy.html';
const SOURCE = 'https://github.com/plhery/peek-delivery-tracker';

function event(stage: ApiTrackingEventRow['stage'], occurredAt: string, extra: Partial<ApiTrackingEventRow> = {}): ApiTrackingEventRow {
  return { id: `${stage}-${occurredAt}`, package_id: 'p1', stage, description: 'Signed by ALEX EXAMPLE, code 4711', location: 'Samplestrasse 1, 9999 Exampletown', occurred_at: occurredAt, place: null, ...extra };
}

function row(overrides: Partial<ApiPackageRow> = {}): ApiPackageRow {
  return {
    id: 'p1', tracking_number: trackingNumber, label: 'New sneakers', carrier: 'dhl', created_at: '2026-09-30T08:00:00+00:00',
    expected_delivery: null, last_status_text: 'Signed by ALEX EXAMPLE', last_synced_at: '2026-10-03T12:30:00+00:00', sync_status: 'ok', sync_error: null,
    tracking_url: `https://carrier.example.test/track/${trackingNumber}`, dpd_postcode: '9999', archived_at: null, notifications_muted: false,
    carrier_data: { sender_name: 'Example Shop', receiver_name: 'Alex Example', pickup_point: 'Example Kiosk\nSamplestrasse 1, 9999 Exampletown' },
    tracking_events: [event('accepted', '2026-10-01T09:00:00+00:00'), event('delivered', '2026-10-03T12:12:00+00:00')],
    ...overrides,
  };
}

function input(overrides: Partial<DeliveryEmailInput> = {}): DeliveryEmailInput {
  return { parcel: row(), locale: 'en', timezone: 'Europe/Zurich', journeyUrl: JOURNEY, offUrl: OFF, now: NOW, ...overrides };
}

/** A message of the English locale file with its variables filled in, so a rewording does not break these tests. */
function english(key: MessageKey, variables: Record<string, string> = {}): string {
  return Object.entries(variables).reduce((message, [name, value]) => message.replaceAll(`{{${name}}}`, value), en[key]);
}

const card = (overrides: Partial<DeliveryCard> = {}): DeliveryCard => ({ png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), ends: { from: 'Hamburg', to: 'Zürich' }, mapped: true, ...overrides });
const cardInput = () => drawn.card.mock.calls.at(-1)![0] as DeliveryCardInput;
const sentence = (text: string) => text.split('\n')[1];

beforeEach(() => {
  drawn.card.mockReset().mockResolvedValue(card());
});
afterEach(() => { vi.restoreAllMocks(); });

describe('deliveryEmailContent', () => {
  it('names the parcel, says who delivered it and when, and shows the same time on the card', async () => {
    const email = await deliveryEmailContent(input());
    expect(email.subject).toBe(english('email.delivered.subject', { name: 'New sneakers' }));
    expect(email.text.split('\n')[0]).toBe(english('email.delivered.title', { name: 'New sneakers' }));
    expect(sentence(email.text)).toBe(english('email.delivered.by.today', { carrier: 'DHL', time: '14:12' }));
    expect(email.html).toContain(`<h1 style=`);
    expect(email.html).toContain(`>${english('email.delivered.title', { name: 'New sneakers' })}</h1>`);
    expect(email.card).toEqual(card().png);
    expect(cardInput()).toMatchObject({ carrier: { id: 'dhl' }, when: 'Today, 14:12', timed: true, languageTag: 'en-CH' });
  });

  it.each([
    ['today', { deliveredTime: 'timed' }, { time: '14:12' }, 'Today, 14:12', true],
    ['yesterday', { deliveredTime: 'timed', now: new Date('2026-10-04T06:00:00Z') }, { time: '14:12' }, 'Yesterday, 14:12', true],
    ['date', { deliveredTime: 'timed', now: new Date('2026-10-08T06:00:00Z') }, { date: '03.10.2026', time: '14:12' }, '03.10.2026, 14:12', true],
    ['day', { deliveredTime: 'date' }, { date: '03.10.2026' }, '03.10.2026', false],
    ['plain', { deliveredTime: 'none' }, {}, null, false],
  ] as const)('says "%s" for a known carrier and for an unknown one', async (kind, overrides, variables, corner, timed) => {
    const known = await deliveryEmailContent(input(overrides));
    expect(sentence(known.text)).toBe(english(`email.delivered.by.${kind}`, { carrier: 'DHL', ...variables }));
    // The picture's corner carries the sentence's own day and clock, or nothing.
    expect(cardInput()).toMatchObject({ when: corner, timed });
    for (const carrier of ['unknown', 'intl-post'] as const) {
      const unknown = await deliveryEmailContent(input({ ...overrides, parcel: row({ carrier }) }));
      expect(sentence(unknown.text)).toBe(english(`email.delivered.line.${kind}`, variables));
      expect(cardInput().carrier).toBeNull();
    }
  });

  it('works the time out from the scan itself when nobody says what it knows', async () => {
    expect(sentence((await deliveryEmailContent(input())).text)).toBe(english('email.delivered.by.today', { carrier: 'DHL', time: '14:12' }));
    // Midnight in the carrier's zone is a day without a clock; a fraction of a second is the app's own stamp.
    const dayOnly = row({ tracking_events: [event('delivered', '2026-10-02T22:00:00+00:00')] });
    expect(sentence((await deliveryEmailContent(input({ parcel: dayOnly }))).text)).toBe(english('email.delivered.by.day', { carrier: 'DHL', date: '03.10.2026' }));
    const noticed = row({ tracking_events: [event('delivered', '2026-10-03T12:12:34.567+00:00')] });
    expect(sentence((await deliveryEmailContent(input({ parcel: noticed }))).text)).toBe(english('email.delivered.by.plain', { carrier: 'DHL' }));
    // What the sender read in the carrier's data decides over the guess.
    expect(sentence((await deliveryEmailContent(input({ parcel: noticed, deliveredTime: 'timed' }))).text))
      .toBe(english('email.delivered.by.today', { carrier: 'DHL', time: '14:12' }));
  });

  it('names the carrier that brought it to the door after a handover, and keeps the app’s mark on the card', async () => {
    const handedOver = row({ carrier: 'swiss-post', carrier_data: { original_carrier: 'dhl', active_tracking_carrier: 'swiss-post' } });
    expect(sentence((await deliveryEmailContent(input({ parcel: handedOver }))).text)).toBe(english('email.delivered.by.today', { carrier: 'Swiss Post', time: '14:12' }));
    expect(cardInput().carrier).toMatchObject({ id: 'dhl' });
    // A last carrier nobody could name is not named, whoever the parcel started with.
    const lostTrack = row({ carrier: 'dhl', carrier_data: { original_carrier: 'dhl', active_tracking_carrier: 'intl-post' } });
    expect(sentence((await deliveryEmailContent(input({ parcel: lostTrack }))).text)).toBe(english('email.delivered.line.today', { time: '14:12' }));
    expect(cardInput().carrier).toMatchObject({ id: 'dhl' });
  });

  it('has a subject and a title for a parcel without a name', async () => {
    for (const label of ['', '  \n ']) {
      const email = await deliveryEmailContent(input({ parcel: row({ label }) }));
      expect(email.subject).toBe(english('email.delivered.subjectUnnamed'));
      expect(email.text.split('\n')[0]).toBe(english('email.delivered.titleUnnamed'));
      expect(email.html).toContain(`>${english('email.delivered.titleUnnamed')}</h1>`);
    }
  });

  it('cuts a long name like a push title and keeps the subject on one line', async () => {
    const long = await deliveryEmailContent(input({ parcel: row({ label: 'n'.repeat(200) }) }));
    expect(long.subject).toBe(english('email.delivered.subject', { name: `${'n'.repeat(79)}…` }));
    const broken = await deliveryEmailContent(input({ parcel: row({ label: 'Books\r\nBcc: someone@example.com\u0000\u2028more\tand more' }) }));
    expect(broken.subject).toBe(english('email.delivered.subject', { name: 'Books Bcc: someone@example.com more and more' }));
    expect(broken.subject).not.toMatch(/[\p{Cc}\u2028\u2029]/u);
  });

  it('escapes whatever comes from the parcel', async () => {
    const label = '<b>&"\'</b><img src=x onerror=alert(1)>';
    const email = await deliveryEmailContent(input({ parcel: row({ label }) }));
    expect(email.html).toContain('&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(email.html).not.toContain('<b>');
    expect(email.html.match(/<img\b/g)).toHaveLength(1);
    // Plain text and the subject are not HTML: they keep the name as it was written.
    expect(email.subject).toContain(label);
    expect(email.text).toContain(label);
    drawn.card.mockResolvedValue(card({ ends: { from: '<Ham"burg>', to: 'Zürich & Co' } }));
    expect((await deliveryEmailContent(input())).html).toContain('alt="Map of the journey from &lt;Ham&quot;burg&gt; to Zürich &amp; Co"');
  });

  it('never carries the tracking number, the recipient, an address, a pickup code or the carrier’s own words', async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const email = await deliveryEmailContent(input({ locale }));
      expect(`${email.subject}\n${email.text}\n${email.html}`).not.toMatch(PRIVATE);
    }
    // The picture is given the parcel to draw its map, and nothing is written from it but place names.
    expect(cardInput().parcel.trackingNumber).toBe(trackingNumber);
  });

  it.each(SUPPORTED_LOCALES)('is written in full in %s', async (locale) => {
    const email = await deliveryEmailContent(input({ locale, deliveredTime: 'timed', now: new Date('2026-10-08T06:00:00Z') }));
    const messages = messagesFor(locale);
    expect(email.subject).toBe(messages['email.delivered.subject'].replace('{{name}}', 'New sneakers'));
    for (const part of [email.subject, email.text, email.html]) {
      expect(part.trim()).not.toBe('');
      expect(part).not.toContain('{{');
      expect(part).not.toContain('undefined');
    }
    expect(email.html).toContain(`<html lang="${locale}">`);
    expect(email.html).toContain(messages['email.delivered.button']);
    expect(email.text).toContain(messages['auth.privacyLink']);
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it('loads nothing and links only the journey, the way out, the privacy notice and the code', async () => {
    const { html } = await deliveryEmailContent(input());
    const addresses = [...html.matchAll(/https?:[^"'\s<>)]*/g)].map(([address]) => address.replaceAll('&amp;', '&'));
    expect(new Set(addresses)).toEqual(new Set([JOURNEY, OFF, PRIVACY, SOURCE]));
    expect([...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map(([, href]) => href)).toEqual([JOURNEY, JOURNEY, OFF, JOURNEY, PRIVACY, SOURCE]);
    // One picture, attached to the message; no style sheet, script, font or frame.
    expect([...html.matchAll(/<img\b[^>]*>/g)].map(([tag]) => tag)).toEqual([expect.stringContaining(`src="cid:${DELIVERY_CARD_CID}"`)]);
    expect(html).not.toMatch(/<(?:script|style|link|iframe|object|embed|form|video|audio|source|svg)\b/i);
    expect(html).not.toMatch(/\burl\(|@import|\bsrcset=|\bbackground=|\bon[a-z]+=/i);
    expect(html.match(/\bsrc=/g)).toHaveLength(1);
  });

  it('is laid out for mail clients: tables, inline styles, a preheader and a light scheme', async () => {
    const { html } = await deliveryEmailContent(input());
    expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    expect(html).toContain('<meta name="color-scheme" content="light">');
    expect(html.match(/<table\b/g)!.length).toBeGreaterThanOrEqual(3);
    for (const [table] of html.matchAll(/<table\b[^>]*>/g)) expect(table).toContain('role="presentation"');
    expect(html).toContain('max-width: 520px');
    // The preheader: the sentence, hidden, before anything else in the body.
    const body = html.slice(html.indexOf('<body'));
    expect(body.indexOf(english('email.delivered.by.today', { carrier: 'DHL', time: '14:12' }))).toBeLessThan(body.indexOf('<table'));
    expect(body).toMatch(/<div style="display: none;[^"]*">[^<]+<\/div>\s*<table/);
    // The header is text, and the button is a real link on a filled cell, as wide as the card above it.
    expect(html).toContain(`>${en['app.title']}</p>`);
    expect(html).toContain(`>${en['app.tagline']}</p>`);
    expect(html).toMatch(new RegExp(`<table [^>]*width="100%" style="margin: 20px 0 0">\\s*<tr>\\s*<td align="center" bgcolor="#f3cf48"[^>]*><a href="${JOURNEY.replace('?', '\\?')}" style="display: block; padding: 15px 20px;[^"]*text-align: center[^"]*">${en['email.delivered.button']}</a></td>`));
  });

  it('ends with why it came, how to stop it, and the two addresses of its last line', async () => {
    const email = await deliveryEmailContent(input());
    const footer = english('email.delivered.footer', { setting: en['email.setting.title'], off: en['email.delivered.footerOff'], alerts: en['email.delivered.footerAlerts'] });
    expect(email.text).toBe([
      english('email.delivered.title', { name: 'New sneakers' }),
      english('email.delivered.by.today', { carrier: 'DHL', time: '14:12' }),
      english('email.delivered.textJourney', { url: JOURNEY }),
      '',
      footer,
      english('email.delivered.textOff', { url: OFF }),
      '',
      `${en['app.title']} · ${en['app.tagline']}`,
      `${en['auth.privacyLink']} · ${PRIVACY}`,
      `GitHub · ${SOURCE}`,
      '',
    ].join('\n'));
    expect(email.html).toContain(`<a href="${OFF}" style="color: #8b9386; text-decoration: underline">${en['email.delivered.footerOff']}</a>`);
    expect(email.html).toContain(`<a href="${JOURNEY}" style="color: #8b9386; text-decoration: underline">${en['email.delivered.footerAlerts']}</a>`);
    expect(email.html).toContain(`${en['app.title']} · ${en['app.tagline']} · <a href="${PRIVACY}" style="color: #8b9386; text-decoration: underline">${en['auth.privacyLink']}</a> · <a href="${SOURCE}" style="color: #8b9386; text-decoration: underline">GitHub</a>`);
    // It is a notice, not part of the message: under the panel, small, pale and centred.
    const notice = /<\/table>\n<\/td>\n<\/tr>\n<tr>\n<td align="center" style="([^"]*)">([^\n]*)<\/td>\n<\/tr>\n<\/table>/.exec(email.html)!;
    expect(notice[1]).toContain('color: #8b9386; font-size: 11px');
    expect(notice[1]).toContain('text-align: center');
    expect(notice[2]).toContain(en['email.delivered.footerOff']);
    expect(notice[2]).toContain(`>GitHub</a>`);
    expect(email.html.indexOf(en['email.delivered.button'])).toBeLessThan(email.html.indexOf(notice[0]));
  });

  it('describes the picture for a reader who does not see it', async () => {
    expect((await deliveryEmailContent(input())).html).toContain(`alt="${english('map.label', { from: 'Hamburg', to: 'Zürich' })}"`);
    drawn.card.mockResolvedValue(card({ ends: null }));
    expect((await deliveryEmailContent(input())).html).toContain(`alt="${en['email.delivered.cardAlt']}"`);
    drawn.card.mockResolvedValue(card({ ends: null, mapped: false }));
    expect((await deliveryEmailContent(input())).html).toContain(`alt="${en['stage.delivered']}"`);
  });

  it('is sent without its picture when the picture cannot be drawn, and says so in the log', async () => {
    const logged = vi.spyOn(observability, 'logOperationalEvent').mockImplementation(() => undefined);
    drawn.card.mockRejectedValue(new RangeError('no canvas today'));
    const email = await deliveryEmailContent(input());
    expect(email.card).toBeNull();
    expect(email.html).not.toMatch(/<img\b|cid:/);
    expect(email.html).toContain(en['email.delivered.button']);
    expect(logged).toHaveBeenCalledExactlyOnceWith('delivery_email_card_failed', { package_id: 'p1', error_type: 'RangeError' }, 'warning');
  });

  it.each([
    ['journeyUrl', { journeyUrl: 'javascript:alert(1)' }],
    ['journeyUrl', { journeyUrl: '/?parcel=1' }],
    ['offUrl', { offUrl: 'mailto:someone@example.com' }],
  ])('refuses a %s that is not a web address', async (name, overrides) => {
    await expect(deliveryEmailContent(input(overrides))).rejects.toThrow(`${name} must be an http(s) address`);
  });

  it('writes in English for a language the app does not have', async () => {
    const email = await deliveryEmailContent(input({ locale: 'nl' as never }));
    expect(email.subject).toBe(english('email.delivered.subject', { name: 'New sneakers' }));
    expect(email.html).toContain('<html lang="en">');
  });

  it('survives a parcel without scans', async () => {
    const email = await deliveryEmailContent(input({ parcel: row({ tracking_events: null }) }));
    expect(sentence(email.text)).toBe(english('email.delivered.by.plain', { carrier: 'DHL' }));
    expect(cardInput()).toMatchObject({ when: null, timed: false });
  });
});

describe('exampleDeliveryEmail', () => {
  it('tells of a made-up parcel in the reader’s language, with links that lead home', async () => {
    const email = await exampleDeliveryEmail('en', 'https://peek.example.test');
    expect(email.subject).toBe(english('email.delivered.subject', { name: 'New sneakers 👟' }));
    expect(sentence(email.text)).toBe(english('email.delivered.by.today', { carrier: 'DHL', time: '14:12' }));
    expect(cardInput()).toMatchObject({ when: 'Today, 14:12', timed: true, carrier: { id: 'dhl' } });
    expect(cardInput().parcel.events.map((scan) => scan.place?.name)).toEqual([undefined, 'Hamburg', 'Regensdorf', 'Zürich', 'Zürich']);
    expect(email.text).toContain(english('email.delivered.textJourney', { url: 'https://peek.example.test/' }));
    // The off page without a token changes nothing.
    expect(email.text).toContain(english('email.delivered.textOff', { url: 'https://peek.example.test/email/off' }));
    const german = await exampleDeliveryEmail('de', 'https://peek.example.test');
    expect(german.subject).toBe('Zugestellt: Neue Sneaker 👟');
    expect(cardInput().parcel.events.at(-1)?.description).toBe('In deinen Briefkasten zugestellt');
  });

  it('draws its picture once per language', async () => {
    drawn.card.mockResolvedValue(card({ png: new Uint8Array([1, 2, 3]) }));
    const first = await exampleDeliveryEmail('fr', 'https://peek.example.test');
    const second = await exampleDeliveryEmail('fr', 'https://other.example.test');
    expect(drawn.card).toHaveBeenCalledTimes(1);
    expect(second.card).toBe(first.card);
    expect(second.text).toContain('https://other.example.test/');
  });

  it('tries again after a picture that failed', async () => {
    vi.spyOn(observability, 'logOperationalEvent').mockImplementation(() => undefined);
    drawn.card.mockRejectedValueOnce(new Error('first reader'));
    expect((await exampleDeliveryEmail('it', 'https://peek.example.test')).card).toBeNull();
    expect((await exampleDeliveryEmail('it', 'https://peek.example.test')).card).toEqual(card().png);
  });
});
