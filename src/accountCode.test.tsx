import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The account's screens stand in as plain words, and arrive when the test lets them.
const mocks = vi.hoisted(() => ({ auth: {} as Record<string, unknown>, arrive: () => undefined as void, fetched: 0 }));
vi.mock('./auth/AuthContext', () => ({ useAuth: () => mocks.auth }));
/** The code as the next page will fetch it: it counts the fetch, and arrives when the test says. */
function accountScreens() {
  vi.doMock('./AccountApplication', async () => {
    mocks.fetched += 1;
    await new Promise<void>((resolve) => { mocks.arrive = resolve; });
    return {
      ApiAccount: ({ auth, demoAddress }: { auth: { status: string }; demoAddress: boolean }) => <p>{demoAddress ? 'The demo' : auth.status === 'authenticated' ? 'The deliveries' : 'The sign-in step'}</p>,
      DemoAccount: () => <p>The demo deliveries</p>,
    };
  });
}

const USER = { id: '10000000-0000-0000-0000-000000000001', email: 'owner@example.test' };
const root = document.documentElement;
/** Other work on the machine can hold a test back; what is waited for here comes in a moment otherwise. */
const WAIT = { timeout: 10_000 };

/** A page as it loads: its modules run anew, with what the browser holds at that moment. */
async function page() {
  vi.resetModules();
  mocks.fetched = 0;
  accountScreens();
  const { ApiApplication } = await import('./ApiApplication');
  const { accountCode } = await import('./accountCode');
  return { ApiApplication, accountCode };
}

beforeEach(() => {
  mocks.auth = {
    status: 'anonymous', user: null, googleEnabled: false, appleEnabled: false, emailOtpEnabled: true,
    getAccessToken: vi.fn(), signInWithGoogle: vi.fn(), signInWithApple: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn(), signOut: vi.fn(),
  };
});
afterEach(() => { vi.doUnmock('./AccountApplication'); delete root.dataset.entry; localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/'); });

describe('the account’s code', () => {
  it('stays away from a visitor’s landing, and comes when signing in opens', async () => {
    const { ApiApplication } = await page();
    render(<ApiApplication />);
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
    expect(mocks.fetched).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    // Until it is here, the page waits as it does for a sign-in being restored.
    expect(screen.getByRole('status')).toHaveTextContent('Opening your parcels…');
    await waitFor(() => expect(mocks.fetched).toBe(1), WAIT);
    await act(async () => { mocks.arrive(); });
    expect(await screen.findByText('The sign-in step', {}, WAIT)).toBeVisible();
  });

  it('keeps the landing in place for someone who signed in elsewhere, until their deliveries can be drawn', async () => {
    const { ApiApplication } = await page();
    const view = render(<ApiApplication />);
    const field = screen.getByRole('textbox', { name: 'Tracking number or link' });
    mocks.auth.status = 'authenticated'; mocks.auth.user = USER;
    view.rerender(<ApiApplication />);
    expect(screen.getByRole('textbox', { name: 'Tracking number or link' })).toBe(field);
    await waitFor(() => expect(mocks.fetched).toBe(1), WAIT);
    await act(async () => { mocks.arrive(); });
    expect(await screen.findByText('The deliveries', {}, WAIT)).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Tracking number or link' })).not.toBeInTheDocument();
  });

  it('keeps the splash for a browser marked before the first paint, and removes the mark with the deliveries', async () => {
    root.dataset.entry = 'app';
    mocks.auth.status = 'authenticated'; mocks.auth.user = USER;
    const { ApiApplication } = await page();
    // The mark alone asked for the code, before anything was drawn.
    expect(mocks.fetched).toBe(1);
    render(<ApiApplication />);
    expect(screen.getByRole('status')).toHaveTextContent('Opening your parcels…');
    expect(root.dataset.entry).toBe('app');
    await act(async () => { mocks.arrive(); });
    expect(await screen.findByText('The deliveries', {}, WAIT)).toBeVisible();
    expect(root.dataset.entry).toBeUndefined();
  });

  it('is asked for at once by a browser that holds a sign-in, at any address, unless it signed out', async () => {
    localStorage.setItem('sb-project-auth-token', '{"access_token":"a"}');
    await page();
    expect(mocks.fetched).toBe(1);
    localStorage.setItem('sb-project-auth-token.signed-out', 'true');
    await page();
    expect(mocks.fetched).toBe(0);
  });

  it('shows the demo at its address once the code is here', async () => {
    history.replaceState(null, '', '/demo');
    mocks.auth.status = 'loading';
    const { ApiApplication } = await page();
    render(<ApiApplication demoRoute />);
    expect(screen.getByRole('status')).toHaveTextContent('Opening your parcels…');
    await act(async () => { mocks.arrive(); });
    expect(await screen.findByText('The demo', {}, WAIT)).toBeVisible();
  });
});
