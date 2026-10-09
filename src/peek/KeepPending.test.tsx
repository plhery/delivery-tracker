import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNotificationPreferences, saveNotificationPreferences, type NotificationPreferences } from '../lib/pushNotifications';
import { LINK_ID } from '../test/parcelLinks';
import { KeepPendingParcel } from './KeepPending';
import { clearPendingKeep, onKeepOutcome, rememberPendingKeep, type KeepOutcome } from './pending';

const mocks = vi.hoisted(() => ({ claim: vi.fn(), retryLoad: vi.fn() }));
vi.mock('./links', async (original) => ({ ...await original<typeof import('./links')>(), claimParcelLinks: mocks.claim }));
vi.mock('../store/ParcelsContext', () => ({ useParcels: () => ({ retryLoad: mocks.retryLoad }) }));
vi.mock('../lib/pushNotifications', async (original) => ({
  ...await original<typeof import('../lib/pushNotifications')>(),
  getNotificationPreferences: vi.fn(),
  saveNotificationPreferences: vi.fn(),
}));

const SAVED: NotificationPreferences = {
  enabledStages: ['out_for_delivery', 'delivered'], quietHoursStart: null, quietHoursEnd: null, timezone: 'Europe/Zurich',
  emailOnDelivery: null, emailAvailable: true,
};
const session = () => ({ userId: 'user-1', getAccessToken: async () => 'token' });
let heard: KeepOutcome[] = [];
let stop = () => {};

beforeEach(() => {
  mocks.claim.mockReset().mockResolvedValue([{ id: LINK_ID, outcome: 'kept', packageId: 'p1' }]);
  mocks.retryLoad.mockReset();
  vi.mocked(getNotificationPreferences).mockReset().mockResolvedValue(SAVED);
  vi.mocked(saveNotificationPreferences).mockReset().mockImplementation(async (preferences) => ({ ...SAVED, ...preferences }));
  heard = [];
  stop = onKeepOutcome((outcome) => heard.push(outcome));
});
afterEach(() => { stop(); clearPendingKeep(); sessionStorage.clear(); });

describe('the deliveries of someone who just signed in', () => {
  it('take the parcel they asked to keep, and reload with it', async () => {
    rememberPendingKeep(LINK_ID);
    render(<KeepPendingParcel auth={session()} />);
    await waitFor(() => expect(mocks.retryLoad).toHaveBeenCalledOnce());
    expect(heard).toEqual([{ id: LINK_ID, outcome: 'kept', packageId: 'p1', name: null }]);
    // Keeping a parcel asks nothing about the email.
    expect(getNotificationPreferences).not.toHaveBeenCalled();
    expect(saveNotificationPreferences).not.toHaveBeenCalled();
  });

  it('switch the delivery email on for someone who signed in to get it, and say so with the parcel', async () => {
    rememberPendingKeep(LINK_ID, { email: true });
    const auth = session();
    render(<KeepPendingParcel auth={auth} />);
    await waitFor(() => expect(mocks.retryLoad).toHaveBeenCalledOnce());
    expect(saveNotificationPreferences).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ emailOnDelivery: true }), auth);
    expect(heard).toEqual([{ id: LINK_ID, outcome: 'kept', packageId: 'p1', name: null, email: true }]);
  });

  it('leave the email alone when the account could not take the parcel', async () => {
    rememberPendingKeep(LINK_ID, { email: true });
    mocks.claim.mockResolvedValue([{ id: LINK_ID, outcome: 'quota' }]);
    render(<KeepPendingParcel auth={session()} />);
    await waitFor(() => expect(heard).toEqual([{ id: LINK_ID, outcome: 'quota', name: null }]));
    expect(saveNotificationPreferences).not.toHaveBeenCalled();
    expect(mocks.retryLoad).not.toHaveBeenCalled();
  });
});
