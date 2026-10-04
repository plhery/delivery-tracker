import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoApplication, shouldUseDemoRepository } from './ClientApplication';
import './test/accountCode';
import { lookupParcel, parcelLinksMode, readParcelLink } from './peek/links';
import { onKeepOutcome, pendingKeep, rememberPendingKeep, type KeepOutcome } from './peek/pending';
import { forgetAllRecents, recentFor, rememberParcel, renameParcel } from './peek/recents';
import { createDemoRepo } from './store/demoRepo';

// This file runs as a build without an API: parcel links stay in the browser.
vi.hoisted(() => { process.env.NEXT_PUBLIC_USE_API = 'false'; });
vi.mock('./App', async () => {
  const { useParcels } = await import('./store/ParcelsContext');
  function Deliveries({ onExitDemo, onOpenLanding }: { onExitDemo?: () => void; onOpenLanding?: () => void }) {
    const { parcels, loading } = useParcels();
    return <div>
      <h1>Deliveries</h1>
      {!loading && <ul>{parcels.map((parcel) => <li key={parcel.id}>{parcel.label || parcel.trackingNumber} ({parcel.events.length} scans)</li>)}</ul>}
      <button type="button" onClick={onExitDemo}>Exit demo</button>
      <button type="button" onClick={onOpenLanding}>Home page</button>
    </div>;
  }
  return { default: Deliveries };
});

describe('shouldUseDemoRepository', () => {
  it('uses the API by default in production', () => {
    expect(shouldUseDemoRepository('production', undefined)).toBe(false);
    expect(shouldUseDemoRepository('production', 'unexpected')).toBe(false);
  });

  it('uses demo data by default in development', () => {
    expect(shouldUseDemoRepository('development', undefined)).toBe(true);
    expect(shouldUseDemoRepository('development', 'unexpected')).toBe(true);
  });

  it('honors explicit settings in every environment', () => {
    expect(shouldUseDemoRepository('production', ' false ')).toBe(true);
    expect(shouldUseDemoRepository('development', ' TRUE ')).toBe(false);
  });
});

describe('DemoApplication', () => {
  const experience = (screen: 'welcome' | 'sign-in' | 'demo') => {
    localStorage.removeItem('sdt.web.experience.v1');
    sessionStorage.removeItem('sdt.web.experience.v1');
    if (screen !== 'welcome') (screen === 'demo' ? localStorage : sessionStorage).setItem('sdt.web.experience.v1', screen);
    window.dispatchEvent(new Event('storage'));
  };
  const app = () => render(<DemoApplication repo={createDemoRepo(window.localStorage)} />);

  beforeEach(() => { experience('welcome'); });
  afterEach(() => { forgetAllRecents(); sessionStorage.clear(); history.replaceState(null, '', '/'); });

  it('keeps lookups in this browser', () => {
    expect(parcelLinksMode).toBe('demo');
  });

  it('greets a visitor with the front door, and follows a fictional number to its own page', async () => {
    const user = userEvent.setup();
    app();
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Tap to open your parcel' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Tracking number or link' }), '1ZDEMO202600000009{Enter}');
    await waitFor(() => expect(location.pathname).toMatch(/^\/p\/[2-9A-HJ-NP-Za-km-z]{12}$/));
    expect(await screen.findByLabelText('UPS')).toBeVisible();
    expect(screen.getByText('Tracking number').parentElement).toHaveTextContent('1ZDEMO202600000009');
    const id = location.pathname.slice(3);
    expect(recentFor(id)?.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('opens sign-in from the front door, where the demo is one step away, and returns to the door from both', async () => {
    const user = userEvent.setup();
    app();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(screen.getByRole('button', { name: 'Explore the demo' }));
    expect(await screen.findByText(/Coffee beans/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Exit demo' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
  });

  it('opens the demo at its own address, and leaves it for the front door at `/`', async () => {
    history.replaceState(null, '', '/demo?view=passport');
    const user = userEvent.setup();
    render(<DemoApplication repo={createDemoRepo(window.localStorage)} demoRoute />);
    expect(await screen.findByText(/Coffee beans/)).toBeVisible();
    // The address is the demo: `/` still opens the front door.
    expect(localStorage.getItem('sdt.web.experience.v1')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Exit demo' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
    expect(location.pathname + location.search).toBe('/');
  });

  it('shows the landing at its own address, whatever this browser remembers, and leads there from the foot of the demo deliveries', async () => {
    experience('demo');
    history.replaceState(null, '', '/home');
    const user = userEvent.setup();
    const landing = render(<DemoApplication repo={createDemoRepo(window.localStorage)} landingRoute />);
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
    landing.unmount();
    // Without accounts the landing is at `/`: the foot's link leaves the demo for it.
    history.replaceState(null, '', '/');
    app();
    expect(await screen.findByText(/Coffee beans/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Home page' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
    expect(location.pathname).toBe('/');
    expect(localStorage.getItem('sdt.web.experience.v1')).toBe('welcome');
  });

  it('shows the demo at its address before an invitation waiting in the tab, which comes back after it', async () => {
    sessionStorage.setItem('sdt.pendingFriendInvitation.v1', JSON.stringify({ code: 'Ab7kP2mQ9xR4tY6n', opened: false, receivedAt: Date.now() }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ previewNickname: 'Paul' }))));
    history.replaceState(null, '', '/demo');
    const user = userEvent.setup();
    render(<DemoApplication repo={createDemoRepo(window.localStorage)} demoRoute />);
    expect(await screen.findByText(/Coffee beans/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Exit demo' }));
    expect(await screen.findByRole('button', { name: 'Tap to open your parcel' })).toBeVisible();
    vi.unstubAllGlobals();
  });

  it('brings the parcel a visitor asked to keep into the demo deliveries, with its history and its name', async () => {
    const { id, key } = await lookupParcel({ trackingNumber: '1ZDEMO202600000009' });
    const view = await readParcelLink(id, { key, advance: true });
    if (view === 'unavailable') throw new Error('The demo link should exist');
    rememberParcel({ id, key, view });
    renameParcel(id, 'Kind of Blue');
    rememberPendingKeep(id);
    experience('sign-in');
    const heard: KeepOutcome[] = [];
    const stop = onKeepOutcome((outcome) => heard.push(outcome));
    const user = userEvent.setup();
    app();
    await user.click(screen.getByRole('button', { name: 'Explore the demo' }));
    expect(await screen.findByText('Kind of Blue (3 scans)')).toBeVisible();
    expect(heard).toMatchObject([{ id, outcome: 'kept', name: 'Kind of Blue' }]);
    expect(recentFor(id)).toBeNull();
    expect(pendingKeep()).toBeNull();
    expect(await readParcelLink(id, { key })).toBe('unavailable');
    stop();
  });

  it('offers the device’s other parcels on the way into the demo, and moves them there', async () => {
    const { id, key } = await lookupParcel({ trackingNumber: 'DEMOGLS20260009' });
    const view = await readParcelLink(id, { key, advance: true });
    if (view === 'unavailable') throw new Error('The demo link should exist');
    rememberParcel({ id, key, view });
    experience('sign-in');
    const user = userEvent.setup();
    app();
    await user.click(screen.getByRole('button', { name: 'Explore the demo' }));
    const sheet = await screen.findByRole('dialog', { name: 'Bring these parcels too?' });
    expect(sheet).toHaveTextContent('DEMOGLS…0009');
    await user.click(screen.getByRole('button', { name: 'Add 1 parcel' }));
    expect(await screen.findByText(/^DEMOGLS20260009 \(\d+ scans\)$/)).toBeVisible();
    expect(recentFor(id)).toBeNull();
    expect(await readParcelLink(id, { key })).toBe('unavailable');
  });

  it('shows a parcel’s page at its address whatever this browser was doing, and leaves it for sign-in', async () => {
    const { id, key, view } = await lookupParcel({ trackingNumber: '1ZDEMO202600000009' });
    rememberParcel({ id, key, view });
    experience('demo');
    history.replaceState(null, '', `/p/${id}`);
    const user = userEvent.setup();
    render(<DemoApplication repo={createDemoRepo(window.localStorage)} parcelLinkId={id} />);
    expect(await screen.findByLabelText('UPS')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Deliveries' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Peek' }));
    expect(location.pathname).toBe('/');
    expect(await screen.findByRole('heading', { name: 'Deliveries' })).toBeVisible();
  });
});
