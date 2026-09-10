import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { ApiAuthenticationError } from './lib/apiClient';
import { createDemoRepo } from './store/demoRepo';
import { ParcelsProvider } from './store/ParcelsContext';
import type { ParcelRepo, ParcelWithEvents, SyncProgress } from './types';

function renderApp(repo: ParcelRepo = createDemoRepo(window.localStorage)) {
  return render(
    <ParcelsProvider repo={repo}>
      <App />
    </ParcelsProvider>,
  );
}

function renderSignedInApp() {
  return render(
    <ParcelsProvider repo={createDemoRepo(window.localStorage)}>
      <App accountEmail="owner@example.test" onSignOut={vi.fn()} />
    </ParcelsProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('App', () => {
  it('lets the demo start fresh from account settings after a gentle confirmation', async () => {
    const repo = createDemoRepo(window.localStorage);
    const original = await repo.list();
    await repo.remove(original[0].id);
    await repo.add({ trackingNumber: '123456789012', label: 'My demo parcel' });
    const user = userEvent.setup();
    renderApp(repo);
    expect(await screen.findByText('My demo parcel')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Account' }));
    await user.click(screen.getByRole('button', { name: 'Account & data' }));
    await user.click(screen.getByRole('button', { name: 'Reset demo data' }));
    expect(screen.getByText('Start the demo fresh?')).toBeInTheDocument();
    expect(screen.queryByText(/permanently delete/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await repo.list()).toHaveLength(original.length + 1);

    await user.click(screen.getByRole('button', { name: 'Reset demo data' }));
    await user.click(screen.getByRole('button', { name: 'Reset demo data' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('My demo parcel')).not.toBeInTheDocument();
    expect(await screen.findByText(original[0].label!)).toBeInTheDocument();
    expect(await repo.list()).toHaveLength(original.length);
  });

  it('adds a Dutch postal shipment with automatic PostNL tracking', async () => {
    const repo = createDemoRepo(window.localStorage);
    const add = vi.spyOn(repo, 'add');
    const user = userEvent.setup();
    renderApp(repo);
    await user.click(await screen.findByRole('button', { name: 'Add a parcel' }));
    const sheet = screen.getByRole('dialog', { name: 'Add a parcel' });
    await user.type(within(sheet).getByLabelText('Tracking number or link'), 'LX123456785NL');
    expect(within(sheet).getByText('PostNL', { selector: 'strong' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Add parcel' }));
    await waitFor(() => expect(add).toHaveBeenCalledWith(expect.objectContaining({
      trackingNumber: 'LX123456785NL', carrier: 'spring-gds',
    })));
  });

  it('adds a German tracked shipment as DHL with automatic updates', async () => {
    const repo = createDemoRepo(window.localStorage);
    const add = vi.spyOn(repo, 'add');
    const user = userEvent.setup();
    renderApp(repo);
    await user.click(await screen.findByRole('button', { name: 'Add a parcel' }));
    const sheet = screen.getByRole('dialog', { name: 'Add a parcel' });
    await user.type(within(sheet).getByLabelText('Tracking number or link'), 'LF123456785DE');
    expect(within(sheet).getByText('DHL', { exact: true })).toBeInTheDocument();
    expect(within(sheet).queryByText('We’ll check DHL for updates automatically.')).not.toBeInTheDocument();
    expect(within(sheet).queryByText(/carrier is still unknown/)).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Add parcel' }));
    await waitFor(() => expect(add).toHaveBeenCalledWith(expect.objectContaining({
      trackingNumber: 'LF123456785DE', carrier: 'dhl',
    })));
  });

  it('automatically checks generic postal tracking and keeps the external lookup link', async () => {
    const repo = createDemoRepo(window.localStorage);
    const [sample] = await repo.list();
    const parcel: ParcelWithEvents = {
      ...sample, carrier: 'intl-post', trackingNumber: 'RA123456785DE',
      trackingUrl: 'https://service.post.ch/ekp-web/ui/entry/search/RA123456785DE',
      label: 'Postal shipment', syncStatus: 'pending', events: [], archivedAt: undefined,
      syncError: undefined,
    };
    repo.list = vi.fn().mockResolvedValue([parcel]);
    const user = userEvent.setup();
    renderApp(repo);
    await user.click(await screen.findByRole('button', { name: 'Add a parcel' }));
    const sheet = screen.getByRole('dialog', { name: 'Add a parcel' });
    await user.type(within(sheet).getByLabelText('Tracking number or link'), parcel.trackingNumber);
    expect(within(sheet).getByText('Unknown postal carrier', { exact: true })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Add parcel' })).toBeEnabled();
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: /Postal shipment — Checking for updates/ }));
    const detail = screen.getByRole('dialog', { name: 'Postal shipment' });
    expect(within(detail).getByText('Unknown postal carrier', { exact: true })).toBeInTheDocument();
    expect(within(detail).getByRole('link', { name: 'Open the 17TRACK website' }))
      .toHaveAttribute('href', 'https://t.17track.net/en#nums=RA123456785DE');
    expect(within(detail).queryByRole('link', { name: /Swiss Post|International Post/ })).not.toBeInTheDocument();
    expect(within(detail).queryByText(/automatic adapter/)).not.toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Check now' })).toBeInTheDocument();
    expect(within(detail).queryByText(/hasn’t announced this shipment/)).not.toBeInTheDocument();
    expect(within(detail).queryByRole('note')).not.toBeInTheDocument();
  });

  it('shows queued, running and completed refresh feedback at the correct time', async () => {
    const repo = createDemoRepo(window.localStorage);
    const parcels = await repo.list();
    let progress: ((phase: SyncProgress) => void) | undefined;
    let finish!: (parcels: ParcelWithEvents[]) => void;
    repo.refresh = vi.fn<ParcelRepo['refresh']>((onProgress) => {
      progress = onProgress;
      progress?.('queued');
      return new Promise((resolve) => { finish = resolve; });
    });
    const user = userEvent.setup();
    renderApp(repo);
    await screen.findByText('Coffee beans ☕');
    await user.click(screen.getByRole('button', { name: 'Refresh tracking' }));
    expect(screen.getByRole('status')).toHaveTextContent('Waiting to check with the carrier');
    act(() => progress?.('running'));
    expect(screen.getByRole('status')).toHaveTextContent('Checking with the carrier');
    await act(async () => finish(parcels));
    expect(screen.getByRole('status')).toHaveTextContent('The latest available tracking is shown.');
  });

  it('keeps keyboard focus in the carrier sheet and restores it to the detail dialog', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByText('New sneakers 👟'));
    const detail = screen.getByRole('dialog', { name: 'New sneakers 👟' });
    const changeCarrier = within(detail).getByRole('button', { name: 'Change carrier from DHL' });
    await user.click(changeCarrier);
    const sheet = screen.getByRole('dialog', { name: 'Change carrier' });
    const select = within(sheet).getByRole('combobox', { name: 'Carrier' });
    expect(detail).toHaveAttribute('inert');
    expect(detail).toHaveAttribute('aria-hidden', 'true');
    expect(select).toHaveFocus();
    await user.selectOptions(select, 'dpd');
    await user.tab();
    expect(within(sheet).getByLabelText(/postcode/i)).toHaveFocus();
    await user.tab({ shift: true });
    expect(select).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Change carrier' })).not.toBeInTheDocument();
    expect(detail).not.toHaveAttribute('inert');
    expect(detail).not.toHaveAttribute('aria-hidden');
    expect(changeCarrier).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.app')).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('separates the latest carrier check from the last shipment event', async () => {
    const repo = createDemoRepo(window.localStorage);
    const parcels = await repo.list();
    const parcel = parcels[0];
    parcel.lastSyncedAt = new Date().toISOString();
    parcel.events = [{
      id: 'old-event', parcelId: parcel.id, stage: 'in_transit',
      description: 'An older carrier scan', occurredAt: '2025-01-01T10:00:00Z',
    }];
    repo.list = vi.fn().mockResolvedValue([parcel]);
    const user = userEvent.setup();
    renderApp(repo);
    await user.click((await screen.findAllByText(parcel.label))[0]);
    const detail = screen.getByRole('dialog', { name: parcel.label });
    const checked = within(detail).getByText(/^Last checked:/);
    const update = within(detail).getByText(/^Last shipment update:/);
    expect(checked.textContent?.replace('Last checked:', '')).not.toBe(
      update.textContent?.replace('Last shipment update:', ''),
    );
    expect(checked).not.toHaveTextContent('2025');
  });

  it('opens a prefilled add sheet for content shared to the installed PWA', async () => {
    window.history.replaceState({}, '', '/?share-target=1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      label: 'Coffee delivery',
      trackingInput: 'Track 993412345612345678',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    renderApp();

    const sheet = await screen.findByRole('dialog', { name: 'Add a parcel' });
    expect(within(sheet).getByLabelText(/^name/i)).toHaveValue('Coffee delivery');
    expect(within(sheet).getByLabelText(/tracking number or link/i)).toHaveValue(
      'Track 993412345612345678',
    );
    expect(window.location.search).toBe('');
  });

  it('shows the seeded demo parcels and the demo banner', async () => {
    renderApp();
    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Deliveries',
    })).toBeInTheDocument();
    expect(await screen.findByText('Coffee beans ☕')).toBeInTheDocument();
    expect(screen.getByText('New sneakers 👟')).toBeInTheDocument();
    expect(screen.getAllByText('Birthday gift 🎁')).toHaveLength(1);
    expect(screen.getByText(/demo mode/i)).toBeInTheDocument();
    expect(
      screen.queryByText('Every shipment, from first lookup to arrival.'),
    ).not.toBeInTheDocument();

    const active = screen.getByRole('region', { name: 'On the way' });
    expect(within(active).getByText('New sneakers 👟')).toBeInTheDocument();
    expect(within(active).getByText('Birthday gift 🎁')).toBeInTheDocument();

    const next = screen.getByRole('button', { name: /Next up: New sneakers/ });
    expect(within(next).getByText('Out for delivery')).toBeInTheDocument();
    expect(next.querySelector('.postage-stamp')).toBeInTheDocument();
    expect(within(next).queryByText('Customs clearance')).not.toBeInTheDocument();
    expect(next.querySelector('.progress-track')).not.toBeInTheDocument();
    expect(next.querySelector('.carrier-mark')).toBeInTheDocument();
    expect(next.querySelector('.parcel-card__hero-bottom > svg')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Needs attention' })).getByText('Birthday gift 🎁')).toBeInTheDocument();

    const past = screen.getByRole('region', { name: 'Past deliveries' });
    expect(within(past).getByText('Coffee beans ☕')).toBeInTheDocument();
  });

  it('orders past deliveries by delivery time, regardless of their ETA or creation order', async () => {
    const repo = createDemoRepo(window.localStorage);
    const sample = (await repo.list()).find(parcel => parcel.events.some(event => event.stage === 'delivered'))!;
    const older: ParcelWithEvents = {
      ...sample, id: 'older-delivery', label: 'Older delivery',
      createdAt: '2026-09-07T12:00:00Z', expectedDelivery: '2026-09-12',
      events: [{ id: 'older-event', parcelId: 'older-delivery', stage: 'delivered', description: 'Delivered', occurredAt: '2026-09-06T12:00:00Z' }],
    };
    const newer: ParcelWithEvents = {
      ...older, id: 'newer-delivery', label: 'Newer delivery',
      createdAt: '2026-09-01T12:00:00Z', expectedDelivery: '2026-09-14',
      events: [{ id: 'newer-event', parcelId: 'newer-delivery', stage: 'delivered', description: 'Delivered', occurredAt: '2026-09-07T12:00:00Z' }],
    };
    vi.spyOn(repo, 'list').mockResolvedValue([older, newer]);
    renderApp(repo);
    const past = await screen.findByRole('region', { name: 'Past deliveries' });
    expect(Array.from(past.querySelectorAll('.parcel-card__label'), element => element.textContent))
      .toEqual(['Newer delivery', 'Older delivery']);
  });

  it('celebrates completed deliveries while preserving the past list and add action', async () => {
    const user = userEvent.setup();
    const repo = createDemoRepo(window.localStorage);
    const delivered = (await repo.list()).filter(parcel => parcel.events.some(event => event.stage === 'delivered'));
    vi.spyOn(repo, 'list').mockResolvedValue(delivered);
    renderApp(repo);
    expect(await screen.findByRole('heading', { name: 'Everything has arrived.' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Past deliveries' })).getByText('Coffee beans ☕')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Track another parcel' }));
    expect(screen.getByRole('dialog', { name: 'Add a parcel' })).toBeInTheDocument();
  });

  it('opens the next parcel from the summary', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', {
      name: /next up: new sneakers/i,
    }));

    expect(screen.getByRole('dialog', { name: 'New sneakers 👟' })).toBeInTheDocument();
    expect(window.location.search).toContain('parcel=');
  });

  it('keeps the signed-in language selector inside the account menu', async () => {
    const user = userEvent.setup();
    const { container } = renderSignedInApp();

    expect(container.querySelector('.language-control--header')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Account options for owner@example.test'));
    const accountMenu = screen.getByRole('dialog', { name: 'Settings' });
    expect(accountMenu).not.toBeNull();
    expect(within(accountMenu as HTMLElement).getByRole('combobox', { name: 'Language' }))
      .toBeInTheDocument();
  });

  it('searches and clears the parcel list', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Coffee beans ☕');

    const viewToggle = screen.getByRole('button', { name: 'Search & filters' });
    expect(viewToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('searchbox', { name: 'Search parcels' })).not.toBeInTheDocument();
    await user.click(viewToggle);
    expect(viewToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('searchbox', { name: 'Search parcels' })).toHaveFocus();

    await user.type(screen.getByRole('searchbox', { name: 'Search parcels' }), 'birthday');

    expect(
      within(screen.getByRole('region', { name: 'Needs attention' }))
        .getByText('Birthday gift 🎁'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Coffee beans ☕')).not.toBeInTheDocument();
    expect(screen.queryByText('New sneakers 👟')).not.toBeInTheDocument();
    expect(screen.getByText('1 shown')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(viewToggle).toHaveFocus();
    expect(viewToggle).toHaveAccessibleDescription('Custom view');
    expect(screen.queryByText('Coffee beans ☕')).not.toBeInTheDocument();
    await user.click(viewToggle);
    expect(screen.getByRole('searchbox')).toHaveValue('birthday');

    await user.clear(screen.getByRole('searchbox', { name: 'Search parcels' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search parcels' }), 'not here');
    expect(screen.getByRole('heading', { name: 'No matching parcels' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(await screen.findByText('Coffee beans ☕')).toBeInTheDocument();
    expect(screen.getByText('16 shown')).toBeInTheDocument();
  });

  it('filters parcels by status and carrier', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Coffee beans ☕');

    const viewToggle = screen.getByRole('button', { name: 'Search & filters' });
    await user.click(viewToggle);
    await user.click(screen.getByRole('button', { name: 'Filters' }));

    await user.selectOptions(screen.getByLabelText('Status'), 'delivered');
    expect(screen.getByText('Coffee beans ☕')).toBeInTheDocument();
    const parcelSections = document.querySelector('.deliveries-page');
    expect(parcelSections).not.toBeNull();
    expect(within(parcelSections as HTMLElement).queryByText('Birthday gift 🎁'))
      .not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Status'), 'all');
    await user.selectOptions(screen.getByLabelText('Carrier'), 'intl-post');
    expect(within(parcelSections as HTMLElement).getByText('Birthday gift 🎁'))
      .toBeInTheDocument();
    expect(screen.queryByText('Coffee beans ☕')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /hide filters/i }));
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unknown postal carrier/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /hide search & filters/i }));
    expect(screen.queryByRole('searchbox', { name: 'Search parcels' })).not.toBeInTheDocument();
    expect(viewToggle).toHaveTextContent('Custom view');
  });

  it('shows one concise status line on each card', async () => {
    using clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(new Date(2026, 8, 9, 12).getTime());
    renderApp();
    expect((await screen.findAllByText('Delivered', { selector: '.parcel-card__state' })).length)
      .toBeGreaterThan(1);
    const deliveredDate = document.querySelector('.parcel-card__completion');
    expect(deliveredDate).toHaveTextContent(/^yesterday$/);
    expect(deliveredDate).not.toHaveTextContent(/^on /);
    expect(screen.getByText('Out for delivery')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Birthday gift.*At customs/ })).toHaveClass('parcel-card--notice');
  });

  it('treats returned parcels as final without calling them delivered', async () => {
    const returned: ParcelWithEvents = {
      id: 'parcel-returned',
      trackingNumber: 'LX123456789DE',
      label: 'Returned shoes',
      carrier: 'intl-post',
      createdAt: '2026-07-10T10:00:00Z',
      syncStatus: 'ok',
      events: [{
        id: 'event-returned',
        parcelId: 'parcel-returned',
        stage: 'returned',
        description: 'Returned to sender',
        occurredAt: '2026-07-20T10:00:00Z',
      }],
    };
    const repo: ParcelRepo = {
      mode: 'api',
      list: vi.fn().mockResolvedValue([returned]),
      add: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn().mockResolvedValue([returned]),
    };

    renderApp(repo);

    expect(await screen.findByText('Returned shoes')).toBeInTheDocument();
    expect(screen.queryByText('Everything has arrived.')).not.toBeInTheDocument();
    expect(document.querySelector('.parcel-card__state > svg')).not.toBeInTheDocument();
    expect(document.querySelector('.delivery-overview__count')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'On the way' })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Returned' })).getByText('Returned shoes'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Past deliveries' })).not.toBeInTheDocument();
  });

  it('shows a tomorrow ETA on the main parcel card', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const pad = (value: number) => String(value).padStart(2, '0');
    const expectedDelivery = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
    const parcel: ParcelWithEvents = {
      id: 'parcel-with-eta',
      trackingNumber: '993412345612345678',
      label: 'Tomorrow parcel',
      carrier: 'swiss-post',
      createdAt: new Date().toISOString(),
      expectedDelivery,
      syncStatus: 'ok',
      events: [],
    };
    const repo: ParcelRepo = {
      mode: 'api',
      list: vi.fn().mockResolvedValue([parcel]),
      add: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn().mockResolvedValue([parcel]),
      refreshParcel: vi.fn().mockResolvedValue(parcel),
    };

    renderApp(repo);

    expect(await screen.findByText('tomorrow', { selector: '.parcel-card__eta' }))
      .toBeInTheDocument();
    const onTheWay = screen.getByRole('region', { name: 'On the way' });
    expect(within(onTheWay).getByRole('button', { name: /Next up: Tomorrow parcel/ })).toBeInTheDocument();
    expect(within(onTheWay).getAllByText('Tomorrow parcel')).toHaveLength(1);
    expect(onTheWay.querySelector('.parcel-section__heading > span')).toHaveTextContent('1');
  });

  it.each(['', ' 13:00–15:00'])('shows today’s ETA once while out for delivery (window: %s)', async (window) => {
    const today = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const expectedDelivery = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}${window}`;
    const parcel: ParcelWithEvents = {
      id: 'parcel-today',
      trackingNumber: '993412345612345678',
      label: 'Today parcel',
      carrier: 'swiss-post',
      createdAt: new Date().toISOString(),
      expectedDelivery,
      syncStatus: 'ok',
      events: [{
        id: 'event-today',
        parcelId: 'parcel-today',
        stage: 'out_for_delivery',
        description: 'Out for delivery',
        occurredAt: new Date().toISOString(),
      }],
    };
    const repo: ParcelRepo = {
      mode: 'api',
      list: vi.fn().mockResolvedValue([parcel]),
      add: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn().mockResolvedValue([parcel]),
    };

    renderApp(repo);

    const section = await screen.findByRole('button', { name: /Next up: Today parcel/ });
    expect(within(section).getByText('Today parcel')).toBeInTheDocument();
    expect(within(section).getAllByText(/^today/)).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'On the way' })).toContainElement(section);
  });

  it('adds a parcel through the bottom sheet', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Coffee beans ☕');

    await user.click(screen.getByRole('button', { name: /add a parcel/i }));
    const sheet = screen.getByRole('dialog', { name: /add a parcel/i });

    await user.type(
      within(sheet).getByLabelText(/^name/i),
      'Fondue set 🫕',
    );
    await user.type(
      within(sheet).getByLabelText(/tracking number/i),
      '99.34.111111.22222222',
    );
    expect(
      within(sheet).getByText(/swiss post/i, { selector: 'strong' }),
    ).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: /add parcel/i }));

    expect(await screen.findByText('Fondue set 🫕')).toBeInTheDocument();
    expect(screen.getByText("Added to tracking")).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: /add a parcel/i }),
    ).not.toBeInTheDocument();
  });

  it('asks for a DPD postcode and submits only four digits', async () => {
    const base = createDemoRepo(window.localStorage);
    const add = vi.fn(base.add);
    const user = userEvent.setup();
    renderApp({ ...base, add });
    await screen.findByText('Coffee beans ☕');

    await user.click(screen.getByRole('button', { name: /add a parcel/i }));
    const sheet = screen.getByRole('dialog', { name: /add a parcel/i });
    await user.type(
      within(sheet).getByLabelText(/tracking number/i),
      '06086514587082',
    );
    await user.selectOptions(within(sheet).getByLabelText(/carrier/i), 'dpd');

    const postcode = within(sheet).getByLabelText(/delivery postcode/i);
    expect(postcode).toBeRequired();
    expect(postcode).toHaveValue('8004');
    await user.clear(postcode);
    expect(within(sheet).getByRole('button', { name: /add parcel/i })).toBeDisabled();

    await user.type(postcode, '80A04');
    expect(postcode).toHaveValue('8004');
    await user.click(within(sheet).getByRole('button', { name: /add parcel/i }));

    expect(add).toHaveBeenCalledWith({
      trackingNumber: '06086514587082',
      label: '',
      carrier: 'dpd',
      dpdPostcode: '8004',
    });
  });

  it('prefills the postcode from the newest DPD parcel', async () => {
    const repo = createDemoRepo(window.localStorage);
    await repo.add({
      trackingNumber: '06086514587082',
      label: 'Previous DPD parcel',
      carrier: 'dpd',
      dpdPostcode: '8004',
    });
    const user = userEvent.setup();
    renderApp(repo);
    await screen.findByText('Previous DPD parcel');

    await user.click(screen.getByRole('button', { name: /add a parcel/i }));
    const sheet = screen.getByRole('dialog', { name: /add a parcel/i });
    await user.type(
      within(sheet).getByLabelText(/tracking number/i),
      '06086514587083',
    );
    await user.selectOptions(within(sheet).getByLabelText(/carrier/i), 'dpd');

    expect(within(sheet).getByLabelText(/delivery postcode/i)).toHaveValue('8004');
  });

  it('offers every regional carrier and keeps carrier postcodes isolated', async () => {
    const repo = createDemoRepo(window.localStorage);
    await repo.add({
      trackingNumber: '06086514587082',
      label: 'Previous DPD parcel',
      carrier: 'dpd',
      dpdPostcode: '8004',
    });
    const add = vi.fn(repo.add);
    const user = userEvent.setup();
    renderApp({ ...repo, add });
    await screen.findByText('Previous DPD parcel');

    await user.click(screen.getByRole('button', { name: /add a parcel/i }));
    const sheet = screen.getByRole('dialog', { name: /add a parcel/i });
    await user.type(within(sheet).getByLabelText(/tracking number/i), '76434219');

    const carrier = within(sheet).getByLabelText('Carrier');
    for (const name of [
      'DPD France',
      'Mondial Relay',
      'Relais Colis',
      'La Poste / Colissimo',
      'Chronopost',
      'GLS France',
      'Colis Privé',
      'GEODIS',
      'Swiss Post Cargo',
      'GLS Switzerland',
      'Colisweb',
      'C Chez Vous',
      'Heppner',
      'Ciblex',
      'Paack',
      "Asendia (check tracking website)",
    ]) {
      expect(within(carrier).getByRole('option', { name })).toBeInTheDocument();
    }

    await user.selectOptions(carrier, 'mondial-relay');
    const postcode = within(sheet).getByLabelText(/delivery postcode/i);
    expect(postcode).toHaveValue('');
    expect(postcode).toHaveAttribute('maxlength', '5');
    expect(within(sheet).getByText(/carrier needs the delivery postcode/i))
      .toBeInTheDocument();

    await user.type(postcode, '59650');
    await user.click(within(sheet).getByRole('button', { name: /add parcel/i }));

    expect(add).toHaveBeenCalledWith({
      trackingNumber: '76434219',
      label: '',
      carrier: 'mondial-relay',
      dpdPostcode: '59650',
    });
  });

  it('shows the first sync in progress and reflects its result without manual refresh', async () => {
    const pendingEvent = {
      id: 'event-pending',
      parcelId: 'parcel-syncing',
      stage: 'pending' as const,
      description: 'Tracking added',
      occurredAt: '2026-07-16T10:00:00Z',
    };
    let parcel: ParcelWithEvents = {
      id: 'parcel-syncing',
      trackingNumber: '993412345612345678',
      label: 'Fresh parcel',
      carrier: 'swiss-post',
      createdAt: '2026-07-16T10:00:00Z',
      syncStatus: 'pending',
      events: [pendingEvent],
    };
    let notify: (() => void | Promise<void>) | undefined;
    const repo: ParcelRepo = {
      mode: 'api',
      list: vi.fn(async () => [parcel]),
      add: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(async () => [parcel]),
      subscribe: (onChange) => {
        notify = onChange;
        return () => undefined;
      },
    };
    renderApp(repo);

    expect(await screen.findByText("Checking for updates", { selector: '.parcel-card__state' }))
      .toBeInTheDocument();

    parcel = {
      ...parcel,
      syncStatus: 'ok',
      events: [
        pendingEvent,
        {
          id: 'event-announced',
          parcelId: parcel.id,
          stage: 'registered',
          description: 'Shipment announced',
          occurredAt: '2026-07-16T10:00:01Z',
        },
      ],
    };
    await act(async () => {
      await notify?.();
    });

    expect(screen.getByRole('button', { name: / — Announced/ })).toBeInTheDocument();
    expect(screen.queryByText("Checking for updates")).not.toBeInTheDocument();
  });

  it('keeps a manual carrier selection for ambiguous tracking numbers', async () => {
    const base = createDemoRepo(window.localStorage);
    const add = vi.fn(base.add);
    const user = userEvent.setup();
    renderApp({ ...base, add });
    await screen.findByText('Coffee beans ☕');

    await user.click(screen.getByRole('button', { name: /add a parcel/i }));
    const sheet = screen.getByRole('dialog', { name: /add a parcel/i });
    await user.type(within(sheet).getByLabelText(/tracking number/i), 'ambiguous-123');
    await user.selectOptions(within(sheet).getByLabelText('Carrier'), 'planzer');
    expect(within(sheet).getByText(/Planzer/i, { selector: 'strong' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: /add parcel/i }));

    expect(add).toHaveBeenCalledWith({
      trackingNumber: 'ambiguous-123',
      label: '',
      carrier: 'planzer',
    });
  });

  it('automatically detects a Planzer delivery number', async () => {
    const base = createDemoRepo(window.localStorage);
    const add = vi.fn(base.add);
    const user = userEvent.setup();
    renderApp({ ...base, add });
    await screen.findByText('Coffee beans ☕');

    await user.click(screen.getByRole('button', { name: /add a parcel/i }));
    const sheet = screen.getByRole('dialog', { name: /add a parcel/i });
    await user.type(
      within(sheet).getByLabelText(/tracking number/i),
      '91346097020038089282',
    );

    expect(
      within(sheet).getByText(/Planzer/i, { selector: 'strong' }),
    ).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: /add parcel/i }));

    expect(add).toHaveBeenCalledWith({
      trackingNumber: '91346097020038089282',
      label: '',
      carrier: 'planzer',
    });
  });

  it('extracts the carrier and tracking number from a pasted tracking link', async () => {
    const base = createDemoRepo(window.localStorage);
    const add = vi.fn(base.add);
    const user = userEvent.setup();
    renderApp({ ...base, add });
    await screen.findByText('Coffee beans ☕');

    await user.click(screen.getByRole('button', { name: /add a parcel/i }));
    const sheet = screen.getByRole('dialog', { name: /add a parcel/i });
    await user.type(
      within(sheet).getByLabelText(/tracking number or link/i),
      'https://www.dpdgroup.com/ch/mydpd/my-parcels/incoming?parcelNumber=06086514587082',
    );

    expect(within(sheet).getByText('06086514587082').closest('p')).toHaveTextContent(
      /found 06086514587082 in the pasted link/i,
    );
    expect(within(sheet).getByText(/DPD/i, { selector: 'strong' })).toBeInTheDocument();
    await user.type(within(sheet).getByLabelText(/delivery postcode/i), '8004');

    await user.click(within(sheet).getByRole('button', { name: /add parcel/i }));

    expect(add).toHaveBeenCalledWith({
      trackingNumber: '06086514587082',
      label: '',
      carrier: 'dpd',
      dpdPostcode: '8004',
    });
  });

  it('captures a complete Planzer shared link from the primary paste field', async () => {
    const base = createDemoRepo(window.localStorage);
    const add = vi.fn(base.add);
    const user = userEvent.setup();
    renderApp({ ...base, add });
    await screen.findByText('Coffee beans ☕');

    await user.click(screen.getByRole('button', { name: /add a parcel/i }));
    const sheet = screen.getByRole('dialog', { name: /add a parcel/i });
    const trackingUrl =
      'https://trackandtrace.planzergroup.com/shared/sendungen/999.90.03316119?accessKey=abcdefghijklmnopqrstuvwxyzABCDEFGH';
    await user.type(within(sheet).getByLabelText(/tracking number or link/i), trackingUrl);

    expect(within(sheet).queryByLabelText(/planzer tracking url/i)).not.toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /add parcel/i })).toBeEnabled();
    await user.click(within(sheet).getByRole('button', { name: /add parcel/i }));

    expect(add).toHaveBeenCalledWith({
      trackingNumber: '999.90.03316119',
      label: '',
      carrier: 'planzer',
      trackingUrl,
    });
  });

  it('captures a complete Dachser capability link from the primary paste field', async () => {
    const base = createDemoRepo(window.localStorage);
    const add = vi.fn(base.add);
    const user = userEvent.setup();
    renderApp({ ...base, add });
    await screen.findByText('Coffee beans ☕');

    await user.click(screen.getByRole('button', { name: /add a parcel/i }));
    const sheet = screen.getByRole('dialog', { name: /add a parcel/i });
    const trackingUrl =
      'https://customeriberia.dachser.com/customerarea/utilidades/seguimiento-publico/detalle?cliente=generico&numeroUnico=9010000001234&fecha=20260513&clave=TESTKEY9';
    await user.type(within(sheet).getByLabelText(/tracking number or link/i), trackingUrl);

    expect(within(sheet).queryByLabelText(/dachser tracking url/i)).not.toBeInTheDocument();
    expect(within(sheet).getByText(/Dachser/i, { selector: 'strong' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /add parcel/i })).toBeEnabled();
    await user.click(within(sheet).getByRole('button', { name: /add parcel/i }));

    expect(add).toHaveBeenCalledWith({
      trackingNumber: '9010000001234',
      label: '',
      carrier: 'dachser',
      trackingUrl,
    });
  });

  it('asks for the complete URL for a Planzer shared-link shipment', async () => {
    const base = createDemoRepo(window.localStorage);
    const add = vi.fn(base.add);
    const user = userEvent.setup();
    renderApp({ ...base, add });
    await screen.findByText('Coffee beans ☕');

    await user.click(screen.getByRole('button', { name: /add a parcel/i }));
    const sheet = screen.getByRole('dialog', { name: /add a parcel/i });
    await user.type(
      within(sheet).getByLabelText(/tracking number/i),
      '999.90.03316119',
    );

    const urlField = within(sheet).getByLabelText(/planzer tracking url/i);
    expect(urlField).toBeRequired();
    expect(within(sheet).getByRole('button', { name: /add parcel/i })).toBeDisabled();

    const trackingUrl =
      'https://trackandtrace.planzergroup.com/shared/sendungen/999.90.03316119?accessKey=abcdefghijklmnopqrstuvwxyzABCDEFGH';
    await user.type(urlField, trackingUrl);
    await user.click(within(sheet).getByRole('button', { name: /add parcel/i }));

    expect(add).toHaveBeenCalledWith({
      trackingNumber: '999.90.03316119',
      label: '',
      carrier: 'planzer',
      trackingUrl,
    });
  });

  it('keeps the add sheet open and reports repository failures', async () => {
    const base = createDemoRepo(window.localStorage);
    const user = userEvent.setup();
    renderApp({ ...base, add: vi.fn().mockRejectedValue(new Error('Duplicate parcel')) });
    await screen.findByText('Coffee beans ☕');

    await user.click(screen.getByRole('button', { name: /add a parcel/i }));
    const sheet = screen.getByRole('dialog', { name: /add a parcel/i });
    await user.type(within(sheet).getByLabelText(/tracking number/i), '123456');
    await user.click(within(sheet).getByRole('button', { name: /add parcel/i }));

    expect(await within(sheet).findByRole('alert')).toHaveTextContent("Couldn’t add this parcel. Check the details and try again.");
    expect(sheet).toBeInTheDocument();
  });

  it('links a duplicate tracking number to its existing parcel', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Coffee beans ☕');

    await user.click(screen.getByRole('button', { name: /add a parcel/i }));
    const sheet = screen.getByRole('dialog', { name: /add a parcel/i });
    await user.type(
      within(sheet).getByLabelText(/tracking number/i),
      '993412345678901234',
    );
    await user.click(within(sheet).getByRole('button', { name: /add parcel/i }));

    const alert = await within(sheet).findByRole('alert');
    expect(alert).toHaveTextContent('already tracking this parcel');
    const link = within(alert).getByRole('link', { name: 'Open the existing parcel' });
    expect(link).toHaveAttribute('href', expect.stringContaining('parcel='));
    await user.click(link);

    expect(screen.queryByRole('dialog', { name: 'Add a parcel' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Coffee beans ☕' })).toBeInTheDocument();
  });

  it('requires a tracking number before submitting', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Coffee beans ☕');

    await user.click(screen.getByRole('button', { name: /add a parcel/i }));
    const sheet = screen.getByRole('dialog', { name: /add a parcel/i });
    expect(
      within(sheet).getByRole('button', { name: /add parcel/i }),
    ).toBeDisabled();
    await user.type(within(sheet).getByLabelText(/tracking number/i), 'hello there');
    expect(within(sheet).getByText(/couldn’t find a tracking number/i)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /add parcel/i })).toBeDisabled();
  });

  it('isolates the add sheet, focuses its primary field, and restores focus', async () => {
    const user = userEvent.setup();
    renderApp();
    const trigger = await screen.findByRole('button', { name: /add a parcel/i });

    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: /add a parcel/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByLabelText(/^name/i)).toHaveFocus();
    expect(document.querySelector('.app')).toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: /add a parcel/i })).not.toBeInTheDocument();
    expect(document.querySelector('.app')).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('');
    expect(trigger).toHaveFocus();
  });

  it('opens the detail view with the full journey timeline', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByText('Coffee beans ☕'));

    const detail = screen.getByRole('dialog', { name: 'Coffee beans ☕' });
    const timeline = within(detail).getByRole('list', {
      name: /tracking history/i,
    });
    expect(timeline.closest('details')).toHaveAttribute('open');
    const items = timeline.querySelectorAll('.tracking-journal__events > li');
    expect(items).toHaveLength(5);

    // The full history starts open, newest first, without a second preview toggle.
    expect(items[0]).toHaveTextContent('Delivered');
    expect(items[4]).toHaveTextContent('The roastery packed your monthly coffee');
    expect(
      within(detail).getByRole('link', { name: /open the swiss post website/i }),
    ).toBeInTheDocument();

    fireEvent(
      detail,
      new MouseEvent('pointerdown', {
        bubbles: true,
        clientX: 12,
        clientY: 180,
      }),
    );
    fireEvent(
      detail,
      new MouseEvent('pointerup', {
        bubbles: true,
        clientX: 142,
        clientY: 190,
      }),
    );
    expect(
      screen.queryByRole('dialog', { name: 'Coffee beans ☕' }),
    ).not.toBeInTheDocument();
  });

  it('shows both handoff trackers and marks Swiss Post as not ready yet', async () => {
    const user = userEvent.setup();
    const parcel: ParcelWithEvents = {
      id: 'parcel-handoff',
      trackingNumber: 'LW230226618CH',
      label: 'AliExpress parcel',
      carrier: 'swiss-post',
      trackingSource: 'aliexpress',
      swissPostReady: false,
      createdAt: '2026-08-06T08:00:00Z',
      syncStatus: 'ok',
      events: [{
        id: 'event-china',
        parcelId: 'parcel-handoff',
        stage: 'in_transit',
        description: 'Departed origin country',
        occurredAt: '2026-08-06T08:00:00Z',
      }],
    };
    const repo: ParcelRepo = {
      mode: 'api',
      list: vi.fn().mockResolvedValue([parcel]),
      add: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn().mockResolvedValue([parcel]),
      refreshParcel: vi.fn().mockResolvedValue(parcel),
    };

    renderApp(repo);
    await user.click(await screen.findByRole('button', { name: /^(?:Next up: )?AliExpress parcel —/ }));

    const detail = screen.getByRole('dialog', { name: 'AliExpress parcel' });
    const sources = within(detail).getByLabelText('Tracking sources');
    expect(within(sources).getByRole('link', { name: /open the aliexpress.*website/i }))
      .toHaveAttribute('href', expect.stringContaining('global.cainiao.com'));
    expect(within(sources).queryByText('Active source')).not.toBeInTheDocument();
    expect(within(sources).getByRole('link', { name: /open the swiss post website.*not ready yet/i }))
      .toHaveAttribute('href', expect.stringContaining('service.post.ch'));
  });

  it('edits a parcel title from the detail view', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByText('Coffee beans ☕'));
    const detail = screen.getByRole('dialog', { name: 'Coffee beans ☕' });
    await user.click(within(detail).getByRole('button', { name: /edit parcel name/i }));

    const title = within(detail).getByRole('textbox', { name: /parcel name/i });
    expect(title).toHaveValue('Coffee beans ☕');
    expect(title).toHaveAttribute('maxlength', '80');
    await user.clear(title);
    await user.type(title, 'Espresso beans');
    await user.click(within(detail).getByRole('button', { name: /save name/i }));

    const renamedDetail = await screen.findByRole('dialog', { name: 'Espresso beans' });
    await user.click(within(renamedDetail).getByRole('button', { name: /back/i }));
    expect(await screen.findByText('Espresso beans')).toBeInTheDocument();
    expect(screen.queryByText('Coffee beans ☕')).not.toBeInTheDocument();
  });

  it('copies a parcel tracking number from its detail ticket', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(window.navigator.clipboard, 'writeText');
    renderApp();

    await user.click(await screen.findByText('Coffee beans ☕'));
    await user.click(screen.getByRole('button', { name: /copy tracking number/i }));

    expect(writeText).toHaveBeenCalledWith('993412345678901234');
    expect(screen.getByRole('button', { name: /copy tracking number/i })).toHaveTextContent('Copied');
  });

  it('mutes one parcel directly from its postcard header', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByText('New sneakers 👟'));

    await user.click(screen.getByRole('button', { name: 'Turn off parcel alerts' }));
    const unmute = screen.getByRole('button', { name: 'Turn parcel alerts on' });
    expect(unmute).toHaveAttribute('aria-pressed', 'true');
    await user.click(unmute);
    expect(screen.getByRole('button', { name: 'Turn off parcel alerts' })).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('.detail__notification-footer')).not.toBeInTheDocument();
  });

  it('opens notification deep links and clears the parcel query on back', async () => {
    const parcel: ParcelWithEvents = {
      id: 'parcel-from-push',
      trackingNumber: '993412345612345678',
      label: 'From notification',
      carrier: 'swiss-post',
      createdAt: '2026-07-15T08:00:00Z',
      syncStatus: 'ok',
      events: [],
    };
    const repo: ParcelRepo = {
      mode: 'api',
      list: vi.fn().mockResolvedValue([parcel]),
      add: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn().mockResolvedValue([parcel]),
      refreshParcel: vi.fn().mockResolvedValue(parcel),
    };
    window.history.replaceState({}, '', '/?parcel=parcel-from-push');
    const user = userEvent.setup();
    renderApp(repo);
    const detail = await screen.findByRole('dialog', { name: 'From notification' });
    expect(detail).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: /back/i }));
    expect(window.location.search).toBe('');
  });

  it('opens parcel details as a browser history entry', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByText('Coffee beans ☕'));
    expect(window.location.search).toContain('parcel=');
    expect(screen.getByRole('dialog', { name: 'Coffee beans ☕' })).toBeInTheDocument();

    act(() => window.history.back());
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Coffee beans ☕' })).not.toBeInTheDocument();
    });
    expect(window.location.search).toBe('');

    act(() => window.history.forward());
    expect(await screen.findByRole('dialog', { name: 'Coffee beans ☕' })).toBeInTheDocument();
  });

  it('archives a parcel immediately and offers undo', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByText('Coffee beans ☕'));
    await user.click(screen.getByLabelText('Parcel actions'));
    await user.click(screen.getByRole('button', { name: /archive parcel/i }));

    expect(screen.queryByRole('dialog', { name: 'Coffee beans ☕' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Coffee beans ☕ archived');
    expect(screen.getByRole('region', { name: 'Archived' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(await screen.findByText('Coffee beans ☕')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Archived' })).queryByText('Coffee beans ☕')).not.toBeInTheDocument();
  });

  it('archives a parcel with a long swipe to the left', async () => {
    renderApp();

    const label = await screen.findByText('Coffee beans ☕');
    const card = label.closest('button');
    expect(card).not.toBeNull();
    fireEvent.pointerDown(card!, { pointerId: 1, isPrimary: true, clientX: 240, clientY: 100 });
    fireEvent.pointerMove(card!, { pointerId: 1, isPrimary: true, clientX: 30, clientY: 105 });
    fireEvent.pointerUp(card!, { pointerId: 1, isPrimary: true, clientX: 30, clientY: 105 });
    fireEvent.click(card!);

    expect(await screen.findByRole('status')).toHaveTextContent('Coffee beans ☕ archived');
    expect(screen.getByRole('region', { name: 'Archived' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Coffee beans ☕' })).not.toBeInTheDocument();
  });

  it('keeps archive failures inside the parcel dialog', async () => {
    const base = createDemoRepo(window.localStorage);
    const user = userEvent.setup();
    renderApp({
      ...base,
      remove: vi.fn().mockRejectedValue(new Error('Archive service unavailable')),
    });

    await user.click(await screen.findByText('Coffee beans ☕'));
    await user.click(screen.getByLabelText('Parcel actions'));
    await user.click(screen.getByRole('button', { name: /archive parcel/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn’t archive this parcel. Try again.");
    expect(screen.getByRole('dialog', { name: 'Coffee beans ☕' })).toBeInTheDocument();
  });

  it('restores a parcel from the collapsed archive', async () => {
    const archived: ParcelWithEvents = {
      id: 'parcel-archived',
      trackingNumber: '993412345612345678',
      label: 'Old delivery',
      carrier: 'swiss-post',
      createdAt: '2026-05-01T10:00:00Z',
      archivedAt: '2026-08-01T10:00:00Z',
      syncStatus: 'ok',
      events: [{
        id: 'delivered-event',
        parcelId: 'parcel-archived',
        stage: 'delivered',
        description: 'Delivered',
        occurredAt: '2026-05-04T10:00:00Z',
      }],
    };
    const restored = { ...archived, archivedAt: undefined };
    const restore = vi.fn().mockResolvedValue(restored);
    const repo: ParcelRepo = {
      mode: 'api',
      list: vi.fn().mockResolvedValue([archived]),
      add: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      restore,
      refresh: vi.fn().mockResolvedValue([archived]),
    };
    const user = userEvent.setup();
    renderApp(repo);

    const archive = await screen.findByRole('region', { name: 'Archived' });
    await user.click(within(archive).getByText('Archived'));
    await user.click(within(archive).getByRole('button', { name: /old delivery/i }));
    await user.click(screen.getByRole('button', { name: /restore parcel/i }));

    expect(restore).toHaveBeenCalledWith(archived.id);
    expect(
      within(await screen.findByRole('region', { name: 'Past deliveries' }))
        .getByText('Old delivery'),
    ).toBeInTheDocument();
  });

  it('permanently deletes an archived parcel after confirmation', async () => {
    const archived: ParcelWithEvents = {
      id: 'parcel-archived',
      trackingNumber: '993412345612345678',
      label: 'Old delivery',
      carrier: 'swiss-post',
      createdAt: '2026-05-01T10:00:00Z',
      archivedAt: '2026-08-01T10:00:00Z',
      syncStatus: 'ok',
      events: [],
    };
    const deletePermanently = vi.fn().mockResolvedValue(undefined);
    const repo: ParcelRepo = {
      mode: 'api',
      list: vi.fn().mockResolvedValue([archived]),
      add: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      restore: vi.fn(),
      deletePermanently,
      refresh: vi.fn().mockResolvedValue([archived]),
    };
    const user = userEvent.setup();
    renderApp(repo);

    const archive = await screen.findByRole('region', { name: 'Archived' });
    await user.click(within(archive).getByText('Archived'));
    await user.click(within(archive).getByRole('button', { name: /old delivery/i }));
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(screen.getByRole('dialog', { name: /permanently delete old delivery/i }))
      .toHaveTextContent('cannot be undone');
    await user.click(within(screen.getByRole('dialog', {
      name: /permanently delete old delivery/i,
    })).getByRole('button', { name: 'Delete permanently' }));

    expect(deletePermanently).toHaveBeenCalledWith(archived.id);
    expect(screen.queryByRole('dialog', { name: 'Old delivery' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Archived' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Old delivery permanently deleted');
  });

  it('changes a parcel carrier and replaces stale tracking history', async () => {
    const parcel: ParcelWithEvents = {
      id: 'parcel-wrong-carrier',
      trackingNumber: '993412345612345678',
      label: 'Wrong carrier',
      carrier: 'swiss-post',
      createdAt: '2026-08-10T10:00:00Z',
      syncStatus: 'ok',
      events: [{
        id: 'stale-event',
        parcelId: 'parcel-wrong-carrier',
        stage: 'in_transit',
        description: 'Stale provider event',
        occurredAt: '2026-08-11T10:00:00Z',
      }],
    };
    const changed: ParcelWithEvents = {
      ...parcel,
      carrier: 'ups',
      syncStatus: 'pending',
      events: [{
        id: 'reset-event',
        parcelId: parcel.id,
        stage: 'pending',
        description: 'Carrier changed; waiting for tracking',
        occurredAt: '2026-09-01T10:00:00Z',
      }],
    };
    const changeCarrier = vi.fn().mockResolvedValue(changed);
    const repo: ParcelRepo = {
      mode: 'api',
      list: vi.fn().mockResolvedValue([parcel]),
      add: vi.fn(),
      rename: vi.fn(),
      changeCarrier,
      remove: vi.fn(),
      refresh: vi.fn().mockResolvedValue([parcel]),
    };
    const user = userEvent.setup();
    renderApp(repo);

    await user.click(await screen.findByRole('button', { name: /^(?:Next up: )?Wrong carrier —/ }));
    await user.click(screen.getByRole('button', { name: 'Change carrier from Swiss Post' }));
    const sheet = screen.getByRole('dialog', { name: 'Change carrier' });
    await user.selectOptions(within(sheet).getByLabelText('Carrier'), 'ups');
    await user.click(within(sheet).getByRole('button', { name: 'Save carrier' }));

    expect(changeCarrier).toHaveBeenCalledWith(parcel.id, {
      carrier: 'ups',
      trackingUrl: undefined,
      dpdPostcode: undefined,
    });
    expect(await screen.findByRole('button', { name: 'Change carrier from UPS' }))
      .toBeInTheDocument();
    expect(screen.queryByText('Stale provider event')).not.toBeInTheDocument();
  });

  it('carefully deletes an active parcel directly from its detail screen', async () => {
    const active: ParcelWithEvents = {
      id: 'parcel-active-delete',
      trackingNumber: '993412345612345678',
      label: 'Duplicate delivery',
      carrier: 'swiss-post',
      createdAt: '2026-08-10T10:00:00Z',
      syncStatus: 'ok',
      events: [],
    };
    const remove = vi.fn();
    const deletePermanently = vi.fn().mockResolvedValue(undefined);
    const repo: ParcelRepo = {
      mode: 'api',
      list: vi.fn().mockResolvedValue([active]),
      add: vi.fn(),
      rename: vi.fn(),
      remove,
      deletePermanently,
      refresh: vi.fn().mockResolvedValue([active]),
    };
    const user = userEvent.setup();
    renderApp(repo);

    await user.click(await screen.findByRole('button', { name: /^(?:Next up: )?Duplicate delivery —/ }));
    await user.click(screen.getByLabelText('Parcel actions'));
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));

    let confirmation = screen.getByRole('dialog', {
      name: /permanently delete duplicate delivery/i,
    });
    expect(deletePermanently).not.toHaveBeenCalled();
    expect(within(confirmation).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', {
      name: /permanently delete duplicate delivery/i,
    })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Duplicate delivery' })).toBeInTheDocument();
    expect(deletePermanently).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText('Parcel actions'));
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
    confirmation = screen.getByRole('dialog', {
      name: /permanently delete duplicate delivery/i,
    });
    await user.click(within(confirmation).getByRole('button', { name: 'Delete permanently' }));

    expect(deletePermanently).toHaveBeenCalledWith(active.id);
    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Duplicate delivery' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Duplicate delivery permanently deleted',
    );
  });

  it('advances the simulation when refreshing in demo mode', async () => {
    const user = userEvent.setup();
    renderApp();

    // The sneakers are out for delivery; one refresh delivers them.
    expect(await screen.findByText('Out for delivery')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /refresh tracking/i }));

    const cards = await screen.findAllByText('Delivered', { selector: '.parcel-card__state' });
    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('status')).toHaveTextContent("The latest available tracking is shown.");
  });

  it('shows initial-load and refresh failures', async () => {
    const failingRepo: ParcelRepo = {
      mode: 'api',
      list: vi.fn()
        .mockRejectedValueOnce(new Error('Could not load deliveries'))
        .mockResolvedValueOnce([]),
      add: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
    };
    const user = userEvent.setup();
    const first = renderApp(failingRepo);
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn’t load your parcels. Try again.");
    expect(screen.queryByText('No parcels yet')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No parcels yet')).toBeInTheDocument();
    first.unmount();

    const base = createDemoRepo(window.localStorage);
    renderApp({ ...base, refresh: vi.fn().mockRejectedValue(new Error('Sync unavailable')) });
    await screen.findByText('Coffee beans ☕');
    await user.click(screen.getByRole('button', { name: /refresh tracking/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent("We can’t reach the tracking service right now.");
  });

  it('shows the last saved parcels when the API is temporarily unavailable', async () => {
    const cached: ParcelWithEvents = {
      id: 'cached-parcel',
      trackingNumber: '993412345612345678',
      label: 'Saved coffee',
      carrier: 'swiss-post',
      createdAt: '2026-07-15T00:00:00Z',
      syncStatus: 'ok',
      events: [],
    };
    const repo: ParcelRepo = {
      mode: 'api',
      list: vi.fn().mockRejectedValue(new Error('You are offline')),
      cachedList: () => [cached],
      add: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
    };

    renderApp(repo);

    expect(await screen.findByRole('button', { name: /^(?:Next up: )?Saved coffee —/ })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Your saved parcels are still available');
    expect(screen.queryByText('No parcels yet')).not.toBeInTheDocument();
  });

  it('offers the sign-in screen when the API session expires', async () => {
    const repo: ParcelRepo = {
      mode: 'api',
      list: vi.fn().mockRejectedValue(new ApiAuthenticationError()),
      add: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
    };

    renderApp(repo);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sign in again to see the latest updates.');
    expect(within(alert).getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('shows a newly unannounced parcel as neutral while automatic checks continue', async () => {
    const parcel: ParcelWithEvents = {
      id: 'pkg-unannounced',
      trackingNumber: '993412345612345678',
      label: 'Early shipping label',
      carrier: 'swiss-post',
      createdAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
      syncStatus: 'waiting',
      events: [{
        id: 'event-added',
        parcelId: 'pkg-unannounced',
        stage: 'pending',
        description: 'Tracking added',
        occurredAt: new Date().toISOString(),
      }],
    };
    const repo: ParcelRepo = {
      mode: 'api',
      list: vi.fn().mockResolvedValue([parcel]),
      add: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn().mockResolvedValue([parcel]),
    };

    renderApp(repo);

    const card = await screen.findByRole('button', {
      name: /Early shipping label — Waiting for the carrier/i,
    });
    expect(card.closest('.parcel-card-swipe')).toHaveAttribute('data-carrier', 'swiss-post');
    expect(screen.queryByText("Update unavailable")).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Needs attention' })).not.toBeInTheDocument();
    expect(
      within(card).getByText('Early shipping label'),
    ).toBeInTheDocument();
  });

  it('explains unavailable tracking without exposing carrier diagnostics', async () => {
    const parcel: ParcelWithEvents = {
      id: 'pkg-error',
      trackingNumber: '993412345612345678',
      label: '',
      carrier: 'swiss-post',
      createdAt: '2026-07-14T10:00:00Z',
      lastSyncedAt: '2026-07-14T12:00:00Z',
      syncStatus: 'error',
      syncError: 'Carrier maintenance',
      events: [],
    };
    const repo: ParcelRepo = {
      mode: 'api',
      list: vi.fn().mockResolvedValue([parcel]),
      add: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn().mockResolvedValue([parcel]),
      refreshParcel: vi.fn().mockResolvedValue(parcel),
    };
    const user = userEvent.setup();
    renderApp(repo);

    expect(await screen.findByRole('button', { name: /Parcel — Update unavailable/ })).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /Parcel — Update unavailable/i }),
    );
    expect(screen.getByRole('status')).toHaveTextContent("The carrier’s latest update is unavailable.");
    expect(
      screen.getByText(/No tracking updates yet/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /check now/i }));
    expect(repo.refreshParcel).toHaveBeenCalledWith(parcel.id, expect.any(Function));
    expect(screen.getByText(/latest available tracking is shown/)).toBeInTheDocument();
  });

  it('shows a friendly empty state when there are no parcels', async () => {
    const repo: ParcelRepo = {
      mode: 'api',
      list: vi.fn().mockResolvedValue([]),
      add: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      restore: vi.fn(),
      refresh: vi.fn().mockResolvedValue([]),
    };
    renderApp(repo);

    expect(await screen.findByText(/no parcels yet/i)).toBeInTheDocument();
    expect(document.querySelector('.delivery-overview__count')).not.toBeInTheDocument();
  });
});
