import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const links = vi.hoisted(() => ({
  en: [{ id: 'customs', slug: 'held-at-customs', title: 'Held at customs' }, { id: 'tracking-statuses', slug: 'tracking-statuses-explained', title: 'Tracking statuses, explained' }],
  fr: [{ id: 'customs', slug: 'colis-en-douane', title: 'Colis en douane' }],
}));
vi.mock('../../generated/guides', () => ({ GUIDE_LINKS: { ...links, de: [], it: [], es: [], pt: [], pl: [] } }));
const analytics = vi.hoisted(() => ({ trackAction: vi.fn() }));
vi.mock('../../lib/analytics', () => analytics);

const { I18nProvider } = await import('../../i18n');
const { GuidesLink } = await import('./Guides');
const en = (await import('../../../shared/locales/en.json')).default;
const fr = (await import('../../../shared/locales/fr.json')).default;
const de = (await import('../../../shared/locales/de.json')).default;

const link = () => screen.getByRole('link', { name: 'Guides' });
const list = () => document.querySelector<HTMLElement>('.landing-guides')!;
let open = false;
/** The browser opens or closes the list, and says so. */
function toggled(element: HTMLElement, now: boolean) {
  open = now;
  element.dispatchEvent(new Event('toggle'));
}
/** Presses the link, and says whether the page took the click instead of leaving it to the browser. */
function press(init?: MouseEventInit): boolean {
  let taken = false;
  const after = (event: Event) => { taken = event.defaultPrevented; event.preventDefault(); };
  document.addEventListener('click', after, { once: true });
  fireEvent.click(link(), init);
  return taken;
}

beforeEach(() => {
  vi.clearAllMocks();
  open = false;
  // jsdom has no popovers: these stand in for the browser's.
  HTMLElement.prototype.showPopover = vi.fn(function showPopover(this: HTMLElement) { toggled(this, true); });
  HTMLElement.prototype.hidePopover = vi.fn(function hidePopover(this: HTMLElement) { toggled(this, false); });
  HTMLElement.prototype.matches = function matches(this: HTMLElement, selector: string) {
    return selector === ':popover-open' ? open : Element.prototype.matches.call(this, selector);
  } as typeof HTMLElement.prototype.matches;
});
afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
  delete (HTMLElement.prototype as Partial<HTMLElement>).hidePopover;
  delete (HTMLElement.prototype as Partial<HTMLElement>).matches;
});

describe('the landing’s way to the guides', () => {
  it('has every guide’s address in the page as the server writes it, and the carriers’, out of sight until asked for', () => {
    const html = renderToString(<GuidesLink />);
    expect(html).toContain('href="/guides"');
    expect(html).toContain('href="/guides/held-at-customs"');
    expect(html).toContain('href="/guides/tracking-statuses-explained"');
    expect(html).toContain('href="/carriers"');
    expect(html).toContain('popover="auto"');
  });

  it('opens the list in place on a plain click, and counts it', () => {
    render(<GuidesLink />);
    expect(link()).toHaveAttribute('href', '/guides');
    // The click is taken: the browser does not follow the link.
    expect(press()).toBe(true);
    expect(list().showPopover).toHaveBeenCalledOnce();
    expect(analytics.trackAction).toHaveBeenCalledWith('guides-open');
    expect(within(list()).getAllByRole('link', { hidden: true }).map((item) => [item.textContent, item.getAttribute('href')])).toEqual([
      ['Held at customs', '/guides/held-at-customs'], ['Tracking statuses, explained', '/guides/tracking-statuses-explained'], ['All guides', '/guides'], ['All carriers', '/carriers'],
    ]);
  });

  it('says whether the list is open, and names it by its heading', () => {
    render(<GuidesLink />);
    expect(link()).toHaveAttribute('aria-expanded', 'false');
    press();
    expect(link()).toHaveAttribute('aria-expanded', 'true');
    // jsdom keeps the list out of sight, where it computes no name: read what names it.
    expect(document.getElementById(list().getAttribute('aria-labelledby')!)).toHaveTextContent(en['guides.heading']);
    // Closed by the browser, as Escape or a press outside it does.
    act(() => toggled(list(), false));
    expect(link()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the list on a press of the link while it is open, by pointer or keyboard, counting only its opening', () => {
    render(<GuidesLink />);
    press();
    // The browser closes an open list on a press outside it; the click that follows must not open it again.
    fireEvent.pointerDown(link());
    act(() => toggled(list(), false));
    expect(press()).toBe(true);
    expect(list().showPopover).toHaveBeenCalledOnce();
    // The next press finds it closed and opens it.
    fireEvent.pointerDown(link());
    press();
    expect(list().showPopover).toHaveBeenCalledTimes(2);
    // Enter closes nothing by itself: the click it makes closes the list.
    fireEvent.keyDown(link(), { key: 'Enter' });
    expect(press()).toBe(true);
    expect(list().hidePopover).toHaveBeenCalledOnce();
    expect(link()).toHaveAttribute('aria-expanded', 'false');
    // The next Enter opens it again.
    fireEvent.keyDown(link(), { key: 'Enter' });
    press();
    expect(list().showPopover).toHaveBeenCalledTimes(3);
    expect(link()).toHaveAttribute('aria-expanded', 'true');
    // A click no press started, as a screen reader makes, finds the list as it is: open, then closed.
    press();
    expect(list().hidePopover).toHaveBeenCalledTimes(2);
    press();
    expect(list().showPopover).toHaveBeenCalledTimes(4);
    expect(analytics.trackAction).toHaveBeenCalledTimes(4);
  });

  it('follows the link to the guides’ own page on a modified click, and in a browser without popovers', () => {
    render(<GuidesLink />);
    expect(press({ metaKey: true })).toBe(false);
    expect(list().showPopover).not.toHaveBeenCalled();
    delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
    expect(press()).toBe(false);
    expect(analytics.trackAction).not.toHaveBeenCalled();
  });

  it('lists the guides of the page’s language, under that language’s addresses', () => {
    render(<I18nProvider initialLocale="fr" initialMessages={fr}><GuidesLink /></I18nProvider>);
    expect(screen.getByRole('link', { name: 'Guides' })).toHaveAttribute('href', '/fr/guides');
    expect(within(list()).getByRole('link', { name: 'Colis en douane', hidden: true })).toHaveAttribute('href', '/fr/guides/colis-en-douane');
    expect(within(list()).getByRole('link', { name: 'Tous les transporteurs', hidden: true })).toHaveAttribute('href', '/fr/carriers');
  });

  it('shows nothing while a language has no guides', () => {
    const { container } = render(<I18nProvider initialLocale="de" initialMessages={de}><GuidesLink /></I18nProvider>);
    expect(container).toBeEmptyDOMElement();
  });
});
