import { getDefaultNormalizer, render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import en from '../../shared/locales/en.json';
import fr from '../../shared/locales/fr.json';
import italian from '../../shared/locales/it.json';
import type { Locale } from '../lib/locale';
import { translateMessage, type Messages, type Translate } from '../lib/messages';
import { SOURCE_URL } from '../lib/source';
import { GuideFrame } from './GuideFrame';
import { GuideIndex } from './GuideIndex';
import { GuidePage } from './GuidePage';
import { parseGuide } from './markdown';
import { GUIDE_SCENES, GuideScene } from './scenes';

const analytics = vi.hoisted(() => ({ trackScreen: vi.fn(), startAnalytics: vi.fn(async () => undefined) }));
vi.mock('../lib/analytics', () => analytics);

const t = (locale: Locale, messages: Messages): Translate => (key, variables) => translateMessage(locale, key, variables, messages);
const links = [
  { id: 'customs', slug: 'held-at-customs', title: 'Held at customs' },
  { id: 'tracking-statuses', slug: 'tracking-statuses-explained', title: 'Tracking statuses, explained' },
  { id: 'tracking-number-formats', slug: 'tracking-number-formats', title: 'Which carrier is this number?' },
];
const guide = parseGuide([
  '---', 'title: Held at customs', 'description: What it means and what to pay.', 'slug: held-at-customs', 'picture: Pip waits at a barrier.',
  'published: 2026-10-04', 'updated: 2026-11-09', '---', '',
  'The lead, with a link to [the statuses](guide:tracking-statuses), to [Peek](/) and to [the post](https://post.example/).', '',
  '## What it means', '', 'A paragraph with `RR123456785CH` and *emphasis*.', '',
  '### A detail', '', '- One', '- Two', '', '1. First', '2. Second', '', '> Peek cannot pay a fee for you.', '',
  '## What you pay', '', '| Country | Limit |', '| --- | --- |', '| EU | 150 EUR |', '',
  ':::steps', '- Wait | Most parcels clear in a day.', '- Pay | On the carrier’s own site.', ':::', '',
  '## Reading the number', '', ':::anatomy RR 12345678 5 CH', '- RR | Registered', '- 12345678 | Serial', '- 5 | Check digit', '- CH | Switzerland', ':::', '',
  ':::journey', '- shop | Seller | Label printed', '- customs | Customs | Cleared', '- home | You | Delivered', ':::', '',
  ':::sources', '- [European Commission](https://taxation-customs.ec.europa.eu/) – buying online', ':::', '',
].join('\n'));

describe('a guide’s page', () => {
  it('shows the title, when it was updated, how long it reads, its picture and its text', () => {
    render(<GuidePage guide={guide} id="customs" locale="en" t={t('en', en)} links={links} others={[]} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Held at customs' })).toBeVisible();
    expect(screen.getByText('Updated 9 November 2026')).toHaveAttribute('datetime', '2026-11-09');
    expect(screen.getByText(/1 min read/)).toBeVisible();
    expect(screen.getByRole('img', { name: 'Pip waits at a barrier.' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Guides' })).toHaveAttribute('href', '/guides');
    expect(document.querySelector('.guide-lead')).toHaveTextContent(/^The lead, with a link/);
    // Another guide in the guide's language, the tracker, and a page elsewhere in a new tab.
    expect(screen.getByRole('link', { name: 'the statuses' })).toHaveAttribute('href', '/guides/tracking-statuses-explained');
    expect(screen.getByRole('link', { name: 'Peek' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'the post' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'the post' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('RR123456785CH').tagName).toBe('CODE');
    expect(screen.getByRole('heading', { level: 3, name: 'A detail' })).toHaveAttribute('id', 'a-detail');
    expect(screen.getByText('Peek cannot pay a fee for you.').tagName).toBe('ASIDE');
    expect(screen.getByRole('rowheader', { name: 'EU' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Limit' })).toBeVisible();
  });

  it('lists its sections once there are three, each leading to its heading', () => {
    render(<GuidePage guide={guide} id="customs" locale="en" t={t('en', en)} links={links} others={[]} />);
    const contents = screen.getByRole('navigation', { name: 'In this guide' });
    expect(within(contents).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['#what-it-means', '#what-you-pay', '#reading-the-number']);
    expect(document.getElementById('what-you-pay')).toHaveTextContent('What you pay');
    // The answer stands above the list, on a phone too.
    expect(document.querySelector('.guide-lead')!.compareDocumentPosition(contents) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws steps, a number taken apart and a journey, and ends with its sources', () => {
    render(<GuidePage guide={guide} id="customs" locale="en" t={t('en', en)} links={links} others={[]} />);
    const steps = document.querySelector('.guide-steps')!;
    expect([...steps.querySelectorAll('li')].map((step) => step.textContent)).toEqual(['1WaitMost parcels clear in a day.', '2PayOn the carrier’s own site.']);
    const anatomy = document.querySelector('.guide-anatomy')!;
    expect(anatomy.querySelector('.guide-anatomy__number')).toHaveAttribute('aria-hidden', 'true');
    expect([...anatomy.querySelectorAll('.guide-anatomy__parts li')].map((part) => part.textContent)).toEqual(['RRRegistered', '12345678Serial', '5Check digit', 'CHSwitzerland']);
    expect([...document.querySelectorAll('.guide-journey li strong')].map((stop) => stop.textContent)).toEqual(['Seller', 'Customs', 'You']);
    const sources = screen.getByRole('region', { name: 'Sources' });
    expect(within(sources).getByRole('link', { name: 'European Commission' })).toHaveAttribute('href', 'https://taxation-customs.ec.europa.eu/');
  });

  it('offers the tracker, then the guides to read next, in the guide’s language', () => {
    const others = links.slice(1).map((link) => ({ link, description: `About ${link.id}.` }));
    render(<GuidePage guide={guide} id="customs" locale="fr" t={t('fr', fr)} links={links} others={others} />);
    // French keeps its no-break space before the question mark.
    expect(screen.getByText(fr['guides.cta.title'], { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) })).toBeVisible();
    // The tracker is the landing in the guide's language, as the links in its text are.
    expect(screen.getAllByRole('link', { name: 'Suivre ton colis' })[0]).toHaveAttribute('href', '/fr');
    expect(screen.getByRole('link', { name: 'Peek' })).toHaveAttribute('href', '/fr');
    const more = screen.getByRole('navigation', { name: 'À lire ensuite' });
    expect(within(more).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/fr/guides/tracking-statuses-explained', '/fr/guides/tracking-number-formats']);
    expect(within(more).getByText('About tracking-statuses.')).toBeVisible();
    expect(screen.getByText('Mis à jour le 9 novembre 2026')).toBeVisible();
  });

  it('dates the first of a month as each language writes it', () => {
    const first = { ...guide, updated: '2026-10-01' };
    const updated = (locale: Locale, messages: Messages) => {
      const { unmount } = render(<GuidePage guide={first} id="customs" locale={locale} t={t(locale, messages)} links={links} others={[]} />);
      const text = document.querySelector('.guide__meta time')!.textContent;
      unmount();
      return text;
    };
    expect(updated('fr', fr)).toBe('Mis à jour le 1er octobre 2026');
    expect(updated('it', italian)).toBe('Aggiornato: 1 ottobre 2026');
    expect(updated('en', en)).toBe('Updated 1 October 2026');
  });

  it('leaves the list of sections out of a short guide', () => {
    const short = parseGuide('---\ntitle: Short\ndescription: Short.\nslug: short\npicture: Pip.\npublished: 2026-10-04\nupdated: 2026-10-04\n---\n\nOnly a lead.\n\n## One section\n\nText.\n');
    render(<GuidePage guide={short} id="customs" locale="en" t={t('en', en)} links={links} others={[]} />);
    expect(screen.queryByRole('navigation', { name: 'In this guide' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Keep reading' })).toBeNull();
  });
});

describe('the guides’ own page', () => {
  it('lists every guide with its picture, its title and what it answers', () => {
    render(<GuideIndex locale="en" t={t('en', en)} guides={links.map((link) => ({ link, description: `About ${link.id}.` }))} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Parcel tracking, explained' })).toBeVisible();
    const cards = screen.getAllByRole('link');
    expect(cards.map((card) => card.getAttribute('href'))).toEqual(['/guides/held-at-customs', '/guides/tracking-statuses-explained', '/guides/tracking-number-formats']);
    expect(within(cards[0]).getByText('Held at customs')).toBeVisible();
    expect(within(cards[0]).getByText('About customs.')).toBeVisible();
    // The picture decorates a link that already says where it leads.
    expect(cards[0].querySelector('svg.guide-scene')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('what stands around a guides page', () => {
  const addresses = { en: '/guides/held-at-customs', de: '/de/guides/paket-beim-zoll', fr: '/fr/guides/colis-en-douane', it: '/it/guides/pacco-in-dogana', es: '/es/guides/paquete-en-aduanas', pt: '/pt/guides/encomenda-na-alfandega', pl: '/pl/guides/paczka-w-urzedzie-celnym' };
  const names = { en: 'English', de: 'Deutsch', fr: 'Français', it: 'Italiano', es: 'Español', pt: 'Português', pl: 'Polski' };

  it('leads to the tracker above, and below to all guides, all carriers, the notice, the code and the page in every language', () => {
    render(<GuideFrame locale="fr" t={t('fr', fr)} addresses={addresses} languageNames={names} screen="guides/fr/customs"><p>The page</p></GuideFrame>);
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Suivre ton colis' })).toHaveAttribute('href', '/fr');
    expect(within(screen.getByRole('banner')).getByRole('link', { name: /Peek/ })).toHaveAttribute('href', '/fr');
    expect(screen.getByRole('main')).toHaveTextContent('The page');
    const foot = screen.getByRole('contentinfo');
    expect(within(foot).getByRole('link', { name: 'Tous les guides' })).toHaveAttribute('href', '/fr/guides');
    expect(within(foot).getByRole('link', { name: 'Tous les transporteurs' })).toHaveAttribute('href', '/fr/carriers');
    expect(within(foot).getByRole('link', { name: 'Confidentialité' })).toHaveAttribute('href', '/privacy.html');
    expect(within(foot).getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', SOURCE_URL);
    expect(within(foot).getByRole('link', { name: /Peek/ })).toHaveAttribute('href', '/fr');
    const languages = within(within(foot).getByRole('navigation', { name: 'Langue' })).getAllByRole('link');
    expect(languages.map((link) => [link.textContent, link.getAttribute('href'), link.getAttribute('hreflang')])).toEqual(
      Object.entries(addresses).map(([locale, address]) => [names[locale as Locale], address, locale]),
    );
    expect(languages.filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.textContent)).toEqual(['Français']);
  });

  it('counts the visit under the page’s own name, as no app open, and leads an English reader to `/`', () => {
    render(<GuideFrame locale="en" t={t('en', en)} addresses={addresses} languageNames={names} screen="guides/en/customs"><p>The page</p></GuideFrame>);
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Track your parcel' })).toHaveAttribute('href', '/');
    expect(analytics.trackScreen).toHaveBeenCalledWith('guides/en/customs', 'anonymous');
    expect(analytics.startAnalytics).toHaveBeenCalledWith({ open: false });
  });

  it('counts a reader signed in on this browser as an account, and one who signed out as anonymous', () => {
    localStorage.setItem('sb-peek-auth-token', '{"access_token":"x"}');
    try {
      const frame = <GuideFrame locale="en" t={t('en', en)} addresses={addresses} languageNames={names} screen="guides/en"><p>The page</p></GuideFrame>;
      const { unmount } = render(frame);
      expect(analytics.trackScreen).toHaveBeenLastCalledWith('guides/en', 'account');
      unmount();
      localStorage.setItem('sb-peek-auth-token.signed-out', 'true');
      render(frame);
      expect(analytics.trackScreen).toHaveBeenLastCalledWith('guides/en', 'anonymous');
    } finally {
      localStorage.clear();
    }
  });
});

describe('the guides’ pictures', () => {
  it.each(GUIDE_SCENES)('draws %s with Pip in it, and no words of any language', (id) => {
    const markup = renderToStaticMarkup(<GuideScene id={id} label="What the picture shows" />);
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="What the picture shows"');
    // Pip's kraft, and nothing written but digits and the letters of a tracking number.
    expect(markup).toContain('--pip-left:#C9A47B');
    const words = [...markup.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(([, text]) => text);
    for (const word of words) expect(word).toMatch(/^[A-Z0-9]+$/);
  });

  it('draws nothing for a guide without a picture', () => {
    expect(renderToStaticMarkup(<GuideScene id="no-such-guide" />)).toBe('');
  });
});
