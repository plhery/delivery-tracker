import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import de from '../../shared/locales/de.json';
import { EmailOffScreen } from './EmailOffScreen';

const mocks = vi.hoisted(() => ({ start: vi.fn(), track: vi.fn() }));
vi.mock('../lib/analytics', async (original) => ({
  ...await original<typeof import('../lib/analytics')>(), startAnalytics: mocks.start, trackAction: mocks.track,
}));

// A made-up token of the shape the server issues.
const TOKEN = 'synthetic.token-for_tests.0123456789'; // gitleaks:allow -- made-up token, never issued by a server
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
/** The server as the page meets it: it keeps what the last request asked for. */
const server = vi.fn<typeof globalThis.fetch>(async (_path, init) =>
  json({ emailOnDelivery: (JSON.parse(String(init?.body)) as { enabled?: boolean }).enabled === true }));
const posted = () => server.mock.calls.map(([path, init]) => [path, init?.method, JSON.parse(String(init?.body))]);

function open(hash: string) {
  window.history.replaceState(null, '', `/email/off${hash}`);
  return render(<EmailOffScreen />);
}
const title = () => screen.getByRole('heading', { level: 1 });
const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  mocks.start.mockReset();
  mocks.track.mockReset();
  server.mockClear();
  vi.stubGlobal('fetch', server);
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('the page a delivery email’s opt-out link opens', () => {
  it('asks first: opening the link sends nothing, and counts nothing', async () => {
    open(`#t=${TOKEN}`);
    expect(title()).toHaveTextContent('Turn off delivery emails?');
    expect(screen.getByText('Peek will stop emailing you when a parcel is delivered. Your notifications stay as they are.')).toBeVisible();
    expect(button('Turn off')).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Open Peek' })).toHaveAttribute('href', '/');
    // A scanner that opens the link, scripts and all, changes nothing: only the button does.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(server).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(document.title).toBe('Peek — Turn off delivery emails?');
  });

  it('turns the email off on its button, says so, and offers the way back', async () => {
    let answer!: (response: Response) => void;
    server.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const user = userEvent.setup();
    open(`#t=${TOKEN}`);
    await user.click(button('Turn off'));
    expect(posted()).toEqual([['/api/email/unsubscribe', 'POST', { token: TOKEN }]]);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    // While the server answers, the button says so and takes no second press.
    const working = button('Turning it off…');
    expect(working).toHaveAttribute('aria-busy', 'true');
    await user.click(working);
    expect(server).toHaveBeenCalledTimes(1);
    await act(async () => { answer(json({ emailOnDelivery: false })); });

    expect(title()).toHaveTextContent('Delivery emails are off');
    expect(screen.getByText('Peek won’t email you when a parcel is delivered. Your notifications haven’t changed.')).toBeVisible();
    // The same button, now the way back: the focus has not moved.
    expect(button('Turn back on')).toHaveFocus();
    expect(document.title).toBe('Peek — Delivery emails are off');
  });

  it('turns it back on with the same link, and off again', async () => {
    const user = userEvent.setup();
    open(`#t=${TOKEN}`);
    await user.click(button('Turn off'));
    await user.click(await screen.findByRole('button', { name: 'Turn back on' }));
    await waitFor(() => expect(title()).toHaveTextContent('Delivery emails are back on'));
    expect(screen.getByText('You’ll get one short email when a parcel is delivered.')).toBeVisible();
    await user.click(button('Turn off'));
    await waitFor(() => expect(title()).toHaveTextContent('Delivery emails are off'));
    expect(posted().map(([, , body]) => body)).toEqual([{ token: TOKEN }, { token: TOKEN, enabled: true }, { token: TOKEN }]);
  });

  it.each([
    ['has no token', ''],
    ['has a token cut short', '#t=abc'],
    ['carries something else', `#token=${TOKEN}`],
  ])('says the link does not work, straight away, when it %s', async (_why, hash) => {
    open(hash);
    expect(title()).toHaveTextContent('This link doesn’t work');
    expect(screen.getByText('Open Peek and go to Settings › Delivery updates to change your emails.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /turn/i })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open Peek' })).toHaveAttribute('href', '/');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(server).not.toHaveBeenCalled();
  });

  it('says the same when the server does not take the token', async () => {
    server.mockResolvedValueOnce(json({ error: 'This link does not work' }, 400));
    const user = userEvent.setup();
    open(`#t=${TOKEN}`);
    await user.click(button('Turn off'));
    await waitFor(() => expect(title()).toHaveTextContent('This link doesn’t work'));
    expect(screen.queryByRole('button', { name: /turn/i })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['the server cannot do it now', () => Promise.resolve(json({ error: 'Email is not configured' }, 503))],
    ['the network is down', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('says it could not be changed when %s, and leaves the button to try again', async (_why, failure) => {
    server.mockImplementationOnce(failure);
    const user = userEvent.setup();
    open(`#t=${TOKEN}`);
    await user.click(button('Turn off'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t change it. Try again.');
    expect(title()).toHaveTextContent('Turn off delivery emails?');
    await user.click(button('Turn off'));
    await waitFor(() => expect(title()).toHaveTextContent('Delivery emails are off'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the token out of every address, the page’s title and what is counted', async () => {
    const user = userEvent.setup();
    open(`#t=${TOKEN}`);
    await user.click(button('Turn off'));
    await screen.findByRole('button', { name: 'Turn back on' });
    expect(window.location.search).toBe('');
    expect(server.mock.calls.every(([path]) => !String(path).includes(TOKEN))).toBe(true);
    expect(document.title).not.toContain(TOKEN);
    expect(JSON.stringify([mocks.track.mock.calls, mocks.start.mock.calls])).not.toContain(TOKEN);
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it('follows the address when its token changes, and forgets the answer to the old one', async () => {
    const user = userEvent.setup();
    open(`#t=${TOKEN}`);
    await user.click(button('Turn off'));
    await screen.findByRole('button', { name: 'Turn back on' });
    await act(async () => {
      window.history.replaceState(null, '', `/email/off#t=${TOKEN}.other`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(title()).toHaveTextContent('Turn off delivery emails?');
    expect(server).toHaveBeenCalledTimes(1);
  });

  it('speaks the reader’s language', () => {
    window.history.replaceState(null, '', `/email/off#t=${TOKEN}`);
    render(<EmailOffScreen initialLocale="de" initialMessages={de} />);
    expect(title()).toHaveTextContent('Zustell-E-Mails ausschalten?');
    expect(button('Ausschalten')).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Peek öffnen' })).toBeVisible();
  });

  it('is drawn by the server as the question, with a button that waits for the page to be live', () => {
    const markup = renderToString(<EmailOffScreen />);
    expect(markup).toContain('Turn off delivery emails?');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Turn off<\/button>/);
    expect(markup).not.toContain('This link doesn’t work');
  });
});
