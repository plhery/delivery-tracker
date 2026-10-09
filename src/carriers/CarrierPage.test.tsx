import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import de from '../../shared/locales/de.json';
import en from '../../shared/locales/en.json';
import { CARRIER_LINKS } from '../generated/carriers';
import { parseCarrierText } from '../guides/markdown';
import { CARRIER_HANDOFF_STORAGE_KEY } from '../lib/carrierHandoff';
import type { Locale } from '../lib/locale';
import { translateMessage, type Messages, type Translate } from '../lib/messages';
import { CarrierIndex } from './CarrierIndex';
import { CarrierPage } from './CarrierPage';
import { CarrierTracker } from './CarrierTracker';

const t = (locale: Locale, messages: Messages): Translate => (key, variables) => translateMessage(locale, key, variables, messages);
const [carrier, neighbour] = CARRIER_LINKS.en;
const guides = [{ id: 'tracking-statuses', slug: 'tracking-statuses-explained', title: 'Tracking statuses, explained' }];
const text = parseCarrierText([
  '---', `title: ${carrier.title}`, 'description: What its numbers look like.', `slug: ${carrier.slug}`,
  'published: 2026-10-04', 'updated: 2026-11-09', '---', '',
  `The lead, with [the statuses](guide:tracking-statuses), [${neighbour.name}](carrier:${neighbour.id}) and [Peek](/).`, '',
  '## Numbers', '', 'A paragraph.', '',
  '## Statuses', '', 'Another.', '',
  '## Questions', '', '### Where is it?', '', 'On its way.', '',
  ':::sources', '- [The carrier](https://carrier.example/)', ':::', '',
].join('\n'));
const others = [{ link: neighbour, description: 'About the other carrier.' }];
const assign = vi.fn();

beforeEach(() => {
  assign.mockClear();
  vi.stubGlobal('location', { ...window.location, assign });
});
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('a carrier’s page', () => {
  it('shows its title, when it was updated, the tracker, then its text with the list of its sections', () => {
    render(<CarrierPage text={text} carrier={carrier} locale="en" t={t('en', en)} guides={guides} others={[]} />);
    expect(screen.getByRole('heading', { level: 1, name: carrier.title })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Carriers' })).toHaveAttribute('href', '/carriers');
    expect(screen.getByText('Updated 9 November 2026')).toHaveAttribute('datetime', '2026-11-09');
    // The tracker stands where a guide has its picture: before the answer.
    const field = screen.getByRole('textbox', { name: `Track a ${carrier.name} parcel` });
    expect(field.compareDocumentPosition(document.querySelector('.guide-lead')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(field).toHaveAccessibleDescription(`Peek is an independent tracker, not ${carrier.name}. It shows what ${carrier.name}’s own tracking publishes.`);
    expect(document.querySelector('figure')).toBeNull();
    // A guide, another carrier's page and the tracker, in the page's language.
    expect(screen.getByRole('link', { name: 'the statuses' })).toHaveAttribute('href', '/guides/tracking-statuses-explained');
    expect(screen.getByRole('link', { name: neighbour.name })).toHaveAttribute('href', `/carriers/${neighbour.slug}`);
    expect(screen.getByRole('link', { name: 'Peek' })).toHaveAttribute('href', '/');
    const contents = screen.getByRole('navigation', { name: 'In this guide' });
    expect(within(contents).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['#numbers', '#statuses', '#questions']);
    expect(screen.getByRole('heading', { level: 3, name: 'Where is it?' })).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Track your parcel' }).at(-1)).toHaveAttribute('href', '/');
    expect(screen.queryByRole('navigation', { name: 'Other carriers' })).toBeNull();
  });

  it('leads to the other carriers of its language, each by a dot of its colour that only decorates', () => {
    render(<CarrierPage text={text} carrier={carrier} locale="de" t={t('de', de)} guides={guides} others={others} />);
    expect(screen.getByRole('link', { name: 'Paketdienste' })).toHaveAttribute('href', '/de/carriers');
    const more = screen.getByRole('navigation', { name: 'Weitere Paketdienste' });
    const [card] = within(more).getAllByRole('link');
    expect(card).toHaveAttribute('href', `/de/carriers/${neighbour.slug}`);
    expect(card).toHaveTextContent(`${neighbour.name}${neighbour.title}About the other carrier.`);
    const swatch = card.querySelector<HTMLElement>('.carrier-swatch')!;
    expect(swatch).toHaveAttribute('aria-hidden', 'true');
    expect(swatch.style.background).not.toBe('');
    expect(swatch.textContent).toBe('');
    expect(screen.getByRole('textbox', { name: `Sendung von ${carrier.name} verfolgen` })).toBeVisible();
  });
});

describe('the carriers’ own page', () => {
  it('lists the carriers of its language, each with its name, its page’s title and what it answers', () => {
    render(<CarrierIndex locale="en" t={t('en', en)} carriers={CARRIER_LINKS.en.map((link) => ({ link, description: `About ${link.id}.` }))} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Tracking by carrier' })).toBeVisible();
    expect(screen.getByText(/Peek tracks more than 3,500 carriers/)).toBeVisible();
    const cards = screen.getAllByRole('link');
    expect(cards.map((card) => card.getAttribute('href'))).toEqual(CARRIER_LINKS.en.map(({ slug }) => `/carriers/${slug}`));
    expect(within(cards[0]).getByText(carrier.title)).toBeVisible();
    expect(within(cards[0]).getByText(`About ${carrier.id}.`)).toBeVisible();
  });

  it('has no list where its language has no carrier yet', () => {
    render(<CarrierIndex locale="en" t={t('en', en)} carriers={[]} />);
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('the tracker on a carrier’s page', () => {
  const tracker = (locale: Locale = 'en') => render(<CarrierTracker locale={locale} color="#dc0032" label="Track a BRT parcel"
    placeholder="Paste a number, link, or message" action="Track your parcel" note="Peek is an independent tracker, not BRT." />);

  it('without a script, opens the landing of its language and sends nothing typed, since its field has no name', () => {
    tracker('it');
    const field = screen.getByRole('textbox', { name: 'Track a BRT parcel' });
    expect(field).not.toHaveAttribute('name');
    expect(field.closest('form')).toHaveAttribute('action', '/it');
    expect(field.closest('form')).toHaveAttribute('method', 'get');
    expect(field.closest('form')!.querySelectorAll('[name]')).toHaveLength(0);
  });

  it('hands what was typed to the landing, never through its address', async () => {
    const user = userEvent.setup();
    tracker('it');
    await user.type(screen.getByRole('textbox'), '  0123456789012  ');
    await user.click(screen.getByRole('button', { name: 'Track your parcel' }));
    expect(assign).toHaveBeenCalledExactlyOnceWith('/it');
    expect(JSON.parse(sessionStorage.getItem(CARRIER_HANDOFF_STORAGE_KEY)!)).toMatchObject({ text: '0123456789012', at: expect.any(Number) });
  });

  it('tracks on Enter, and keeps Shift+Enter for a new line in a pasted message', async () => {
    const user = userEvent.setup();
    tracker();
    const field = screen.getByRole('textbox');
    await user.type(field, 'Your parcel{Shift>}{Enter}{/Shift}0123456789012');
    expect(assign).not.toHaveBeenCalled();
    expect(field).toHaveValue('Your parcel\n0123456789012');
    await user.type(field, '{Enter}');
    // The landing's own address: at `/`, someone signed in sees their deliveries.
    expect(assign).toHaveBeenCalledExactlyOnceWith('/home');
    expect(JSON.parse(sessionStorage.getItem(CARRIER_HANDOFF_STORAGE_KEY)!).text).toBe('Your parcel\n0123456789012');
  });

  it('goes nowhere with an empty field, and puts the cursor in it', async () => {
    const user = userEvent.setup();
    tracker();
    await user.type(screen.getByRole('textbox'), '   ');
    await user.click(screen.getByRole('button', { name: 'Track your parcel' }));
    expect(assign).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CARRIER_HANDOFF_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole('textbox')).toHaveFocus();
  });
});
