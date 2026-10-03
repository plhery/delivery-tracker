import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { createDemoRepo } from './store/demoRepo';
import { ParcelsProvider } from './store/ParcelsContext';
import { inspectPushState } from './lib/pushNotifications';
import type { ParcelRepo, ParcelWithEvents } from './types';

vi.mock('./lib/pushNotifications', async importOriginal => ({
  ...await importOriginal<typeof import('./lib/pushNotifications')>(),
  inspectPushState: vi.fn(),
  getNotificationPreferences: vi.fn().mockResolvedValue({ enabledStages: [], timezone: 'Europe/Zurich', quietHoursStart: null, quietHoursEnd: null }),
}));
// Control the end of the celebration independently from its animation tests.
vi.mock('./components/ParcelAddedBurst', () => ({
  ParcelAddedBurst: ({ onFinished }: { onFinished: () => void }) => <button onClick={onFinished}>Finish parcel animation</button>,
}));

const apiAuth = { userId: 'account', getAccessToken: vi.fn().mockResolvedValue('token') };
const invitation = () => screen.queryByRole('region', { name: 'Get delivery updates' });
const renderApp = (repo: ParcelRepo) => render(<ParcelsProvider repo={repo}><App apiAuth={apiAuth} /></ParcelsProvider>);

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.mocked(inspectPushState).mockReset().mockResolvedValue({ kind: 'prompt', publicKey: 'public' });
});

describe('web notification invitation placement', () => {
  it('never invites demo users, even when parcels exist', async () => {
    renderApp(createDemoRepo(localStorage));
    await screen.findByText('Coffee beans ☕');
    expect(invitation()).not.toBeInTheDocument();
    expect(inspectPushState).not.toHaveBeenCalled();
  });

  it('waits for the first successful add, closed form and completed celebration', async () => {
    const demo = createDemoRepo(localStorage);
    const [sample] = await demo.list();
    let parcels: ParcelWithEvents[] = [];
    const repo: ParcelRepo = {
      ...demo, mode: 'api', list: vi.fn(async () => parcels),
      add: vi.fn(async input => {
        const parcel = { ...sample, id: 'first-parcel', trackingNumber: input.trackingNumber, label: 'First parcel' };
        parcels = [parcel];
        return parcel;
      }),
    };
    const user = userEvent.setup();
    renderApp(repo);
    await act(async () => {});
    expect(inspectPushState).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add a parcel' }));
    const sheet = screen.getByRole('dialog', { name: 'Add a parcel' });
    await user.type(within(sheet).getByLabelText('Tracking number or link'), 'LX123456785NL');
    expect(invitation()).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Add parcel' }));
    const finish = await screen.findByRole('button', { name: 'Finish parcel animation' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(invitation()).not.toBeInTheDocument();
    await user.click(finish);
    expect(await screen.findByRole('region', { name: 'Get delivery updates' })).toBeInTheDocument();
  });

  it('invites existing accounts only on Deliveries and yields to Settings', async () => {
    const repo: ParcelRepo = { ...createDemoRepo(localStorage), mode: 'api' };
    const user = userEvent.setup();
    renderApp(repo);
    await screen.findByRole('region', { name: 'Get delivery updates' });
    await user.click(screen.getByRole('button', { name: 'Passport' }));
    expect(invitation()).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deliveries' }));
    await screen.findByRole('region', { name: 'Get delivery updates' });
    await user.click(screen.getByRole('button', { name: 'Account' }));
    await screen.findByRole('dialog', { name: 'Settings' });
    await waitFor(() => expect(document.querySelector('.app')).toHaveAttribute('inert'));
    expect(invitation()).not.toBeInTheDocument();
  });
});
