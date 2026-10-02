import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scroll, stubIntersections } from '../../test/intersections';
import { Landing } from './Landing';
import { LandingFooter } from './Who';
import { SCAN_MS } from './useJourneyStory';

// The map and the cards have their own tests; here they show what the sections hand them.
vi.mock('./JourneyMap', () => ({ default: ({ scan }: { scan: number }) => <div data-testid="journey-map">scan {scan}</div> }));
vi.mock('./SampleList', () => ({ default: () => <div data-testid="sample-list" /> }));

const onSignIn = vi.fn();
const card = () => document.querySelector<HTMLElement>('.landing-journey')!;
const journey = () => screen.getByRole('img', { name: 'A parcel’s journey, scan by scan' });
/** What the card says now: the line that shows among those that take turns. */
const showing = (selector: string) => document.querySelector(`${selector}[data-on]`)!.textContent;
const pass = (milliseconds: number) => act(() => { vi.advanceTimersByTime(milliseconds); });
function motion(reduced: boolean) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: reduced && query.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}

beforeEach(() => {
  vi.clearAllMocks();
  stubIntersections();
  motion(false);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Landing', () => {
  it('asks the visitor’s next three questions, in order, and answers each in words', () => {
    render(<Landing onSignIn={onSignIn} />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Will I know when it moves?', 'Following more than one?', 'Who’s behind Peek?',
    ]);
    const moves = screen.getByRole('region', { name: 'Will I know when it moves?' });
    expect(within(moves).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Checked every 10 min', 'Every 2 min on the last mile']);
    const more = screen.getByRole('region', { name: 'Following more than one?' });
    expect(within(more).getAllByRole('listitem')).toHaveLength(3);
    expect(within(more).getByText('Pings for the steps you choose')).toBeVisible();
    const who = screen.getByRole('region', { name: 'Who’s behind Peek?' });
    expect(within(who).getAllByRole('listitem').map((item) => item.querySelector('strong')!.textContent))
      .toEqual(['Open source', 'No account needed', 'Forgets on its own']);
    expect(within(who).getByText('Without an account, a parcel is forgotten 30 days after it arrives.')).toBeVisible();
    expect(within(who).getByRole('link', { name: 'View on GitHub' })).toHaveAttribute('href', 'https://github.com/plhery/delivery-tracker');
  });

  it('keeps the moving pictures out of a screen reader’s way', () => {
    render(<Landing onSignIn={onSignIn} />);
    // The journey is one image with a name; its pings, the phone and the passport are for the eye only.
    expect(journey()).toBeVisible();
    expect(document.querySelector('.landing-pings')).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('.landing-phone')).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('.landing-list')).toBeDisabled();
    expect(document.querySelector('.landing-passport')).toHaveAttribute('aria-hidden', 'true');
    expect(within(document.querySelector<HTMLElement>('.landing-phone')!).queryByRole('button')).toBeNull();
  });

  it('opens sign-in from the section that says why, under a name of its own', async () => {
    render(<Landing onSignIn={onSignIn} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in to keep them all' }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it('offers the iPhone app only to a build that names its page', async () => {
    render(<Landing onSignIn={onSignIn} />);
    expect(screen.queryByRole('link', { name: 'Get the iPhone app' })).not.toBeInTheDocument();
    const { publicLink } = await import('./links');
    expect(publicLink('https://apps.example.test/peek')).toBe('https://apps.example.test/peek');
    expect(publicLink(' https://apps.example.test/peek ')).toBe('https://apps.example.test/peek');
    // Nothing but a secure address becomes a link.
    for (const value of [undefined, '', 'http://apps.example.test/peek', 'javascript:alert(1)', 'apps.example.test']) expect(publicLink(value)).toBeNull();

    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_IOS_APP_URL', 'https://apps.example.test/peek');
    const fresh = await import('./More');
    render(<fresh.More onSignIn={onSignIn} landed={false} />);
    expect(screen.getByRole('link', { name: 'Get the iPhone app' })).toHaveAttribute('href', 'https://apps.example.test/peek');
  });

  it('ends with the name, the privacy notice, the code and the language', () => {
    render(<LandingFooter />);
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent('Peek · Universal Parcel Tracker');
    expect(within(footer).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy.html');
    expect(within(footer).getByRole('link', { name: 'GitHub' })).toHaveAttribute('target', '_blank');
    expect(within(footer).getByRole('combobox', { name: 'Language' })).toHaveValue('en');
  });

  it('draws its words on the server, and none of the map or the cards', () => {
    const html = renderToString(<Landing onSignIn={onSignIn} />);
    expect(html).toContain('Will I know when it moves?');
    expect(html).toContain('In transit');
    expect(html).toContain('Collected by DHL');
    expect(html).not.toContain('journey-map');
    expect(html).not.toContain('sample-list');
  });

  it('loads the map and the cards only when their sections come near', async () => {
    render(<Landing onSignIn={onSignIn} />);
    expect(screen.queryByTestId('journey-map')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sample-list')).not.toBeInTheDocument();
    scroll(card(), .1);
    expect(await screen.findByTestId('journey-map')).toHaveTextContent('scan 0');
    expect(screen.queryByTestId('sample-list')).not.toBeInTheDocument();
    scroll(document.querySelector('.landing-phone')!, .1);
    expect(await screen.findByTestId('sample-list')).toBeInTheDocument();
  });
});

describe('Landing: the journey', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('tells four scans while its card is on screen: the headline, the step and the ping change together', () => {
    render(<Landing onSignIn={onSignIn} />);
    expect(showing('.landing-stack > div')).toBe('In transitArrives in 2 days');
    expect(showing('.landing-ping')).toContain('Collected by DHL');
    expect(showing('.landing-ping')).toContain('New sneakers · Hamburg, 17:48');
    // Off screen, nothing moves.
    pass(4 * SCAN_MS);
    expect(journey()).toHaveAttribute('data-scan', '0');

    scroll(card(), .6);
    pass(SCAN_MS);
    expect(journey()).toHaveAttribute('data-scan', '1');
    expect(showing('.landing-stack > div')).toBe('Cleared customsArrives tomorrow');
    expect(showing('.landing-ping')).toContain('New sneakers · Basel, 23:05');
    pass(SCAN_MS);
    expect(showing('.landing-stack > div')).toBe('Out for deliverytoday, 13:00–17:00');
    expect(showing('.landing-ping')).toContain('New sneakers · today, 13:00–17:00');
    expect(document.querySelector('.landing-journey__live')).toHaveAttribute('data-pulse');
    expect(document.querySelector('.landing-stamp--new')).not.toHaveAttribute('data-landed');

    // Delivered: the pulse stops, and a stamp lands in the passport.
    pass(SCAN_MS);
    expect(showing('.landing-stack > div')).toBe('DeliveredLeft in your mailbox at 14:12');
    expect(showing('.landing-ping')).toContain('New sneakers · in your mailbox, 14:12');
    expect(document.querySelector('.landing-journey__live')).not.toHaveAttribute('data-pulse');
    expect(document.querySelector('.landing-stamp--new')).toHaveAttribute('data-landed');
    expect(document.querySelectorAll('.landing-journey .progress-track__dot--filled')).toHaveLength(6);

    // Then the story starts over.
    pass(SCAN_MS);
    expect(journey()).toHaveAttribute('data-scan', '0');
    expect(document.querySelector('.landing-stamp--new')).not.toHaveAttribute('data-landed');
  });

  it('waits until a good part of the card shows, and holds when it leaves', () => {
    render(<Landing onSignIn={onSignIn} />);
    scroll(card(), .1);
    pass(2 * SCAN_MS);
    expect(journey()).toHaveAttribute('data-scan', '0');
    scroll(card(), .5);
    pass(SCAN_MS);
    expect(journey()).toHaveAttribute('data-scan', '1');
    scroll(card(), 0);
    pass(5 * SCAN_MS);
    expect(journey()).toHaveAttribute('data-scan', '1');
  });

  it('holds in a background tab', () => {
    render(<Landing onSignIn={onSignIn} />);
    scroll(card(), 1);
    pass(SCAN_MS);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    pass(5 * SCAN_MS);
    expect(journey()).toHaveAttribute('data-scan', '1');
    vi.restoreAllMocks();
  });

  it('shows someone who asked for less motion the parcel on its last mile, and never moves', () => {
    motion(true);
    render(<Landing onSignIn={onSignIn} />);
    scroll(card(), 1);
    expect(journey()).toHaveAttribute('data-scan', '2');
    expect(showing('.landing-stack > div')).toBe('Out for deliverytoday, 13:00–17:00');
    expect(showing('.landing-ping')).toContain('Out for delivery');
    pass(10 * SCAN_MS);
    expect(journey()).toHaveAttribute('data-scan', '2');
    expect(vi.getTimerCount()).toBe(0);
  });
});
