import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
} from '../lib/pushNotifications';
import {
  loadNotificationPreferences,
  saveEmailOnDelivery,
  saveNotificationStages,
  turnOnDeliveryEmail,
  useDeliveryEmail,
  useNotificationPreferences,
} from './notificationPreferences';

vi.mock('../lib/pushNotifications', () => ({
  getNotificationPreferences: vi.fn(),
  saveNotificationPreferences: vi.fn(),
}));

const SAVED: NotificationPreferences = {
  enabledStages: ['out_for_delivery', 'delivered'],
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  timezone: 'Europe/Zurich',
  emailOnDelivery: null,
  emailAvailable: true,
};
const session = () => ({ userId: 'user-1', getAccessToken: vi.fn().mockResolvedValue('token') });

beforeEach(() => {
  vi.mocked(getNotificationPreferences).mockReset().mockResolvedValue(SAVED);
  // The server answers with what it kept: the request, over what was stored.
  vi.mocked(saveNotificationPreferences).mockReset().mockImplementation(async (preferences) => ({ ...SAVED, ...preferences }));
});

describe('the account’s shared notification preferences', () => {
  it('are null until read, then the same copy for every reader of the sign-in', async () => {
    const auth = session();
    const first = renderHook(() => useNotificationPreferences(auth));
    const second = renderHook(() => useNotificationPreferences(auth));
    expect(first.result.current).toBeNull();
    await act(async () => { await loadNotificationPreferences(auth); });
    expect(first.result.current).toEqual(SAVED);
    expect(second.result.current).toBe(first.result.current);
    // Another sign-in, and no account at all, see nothing of it.
    expect(renderHook(() => useNotificationPreferences(session())).result.current).toBeNull();
    expect(renderHook(() => useNotificationPreferences(undefined)).result.current).toBeNull();
  });

  it('are read once per sign-in by the deliveries, however the session object is renewed, and again whenever Settings asks', async () => {
    const signal = new AbortController().signal;
    const auth = { ...session(), signal };
    await Promise.all([loadNotificationPreferences(auth, { once: true }), loadNotificationPreferences(auth, { once: true })]);
    // A token refresh hands the app a new object for the same sign-in.
    const renewed = { ...session(), signal };
    await expect(loadNotificationPreferences(renewed, { once: true })).resolves.toEqual(SAVED);
    expect(getNotificationPreferences).toHaveBeenCalledTimes(1);
    expect(renderHook(() => useNotificationPreferences(renewed)).result.current).toEqual(SAVED);

    vi.mocked(getNotificationPreferences).mockResolvedValue({ ...SAVED, emailOnDelivery: false });
    await expect(loadNotificationPreferences(renewed)).resolves.toMatchObject({ emailOnDelivery: false });
    expect(getNotificationPreferences).toHaveBeenCalledTimes(2);
  });

  it('asks again after a read that failed', async () => {
    const auth = session();
    vi.mocked(getNotificationPreferences).mockRejectedValueOnce(new Error('offline'));
    await expect(loadNotificationPreferences(auth, { once: true })).rejects.toThrow('offline');
    await expect(loadNotificationPreferences(auth, { once: true })).resolves.toEqual(SAVED);
  });

  it('switches the email alone: the events go as last saved, and the copy becomes the server’s answer', async () => {
    const auth = session();
    await loadNotificationPreferences(auth);
    const { result } = renderHook(() => useNotificationPreferences(auth));
    await act(async () => { await saveEmailOnDelivery(true, auth); });
    expect(saveNotificationPreferences).toHaveBeenCalledExactlyOnceWith({
      enabledStages: ['out_for_delivery', 'delivered'],
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      emailOnDelivery: true,
    }, auth);
    expect(result.current).toMatchObject({ emailOnDelivery: true, emailAvailable: true });

    // The server may keep something else than was asked for: its answer is what shows.
    vi.mocked(saveNotificationPreferences).mockResolvedValueOnce({ ...SAVED, emailOnDelivery: true, emailAvailable: false });
    await act(async () => { await saveEmailOnDelivery(false, auth); });
    expect(result.current).toMatchObject({ emailOnDelivery: true, emailAvailable: false });
  });

  it('cannot switch the email before the preferences are read, and keeps the copy when a save fails', async () => {
    const auth = session();
    await expect(saveEmailOnDelivery(true, auth)).rejects.toThrow();
    expect(saveNotificationPreferences).not.toHaveBeenCalled();

    await loadNotificationPreferences(auth);
    vi.mocked(saveNotificationPreferences).mockRejectedValueOnce(new Error('Email is not available for this account'));
    await expect(saveEmailOnDelivery(true, auth)).rejects.toThrow('not available');
    expect(renderHook(() => useNotificationPreferences(auth)).result.current).toEqual(SAVED);
  });

  it('switches the email on for someone who signed in to get it, over an earlier “off”, and only where the server can write', async () => {
    for (const emailOnDelivery of [null, false]) {
      const auth = session();
      vi.mocked(getNotificationPreferences).mockResolvedValueOnce({ ...SAVED, emailOnDelivery });
      await expect(turnOnDeliveryEmail(auth)).resolves.toBe(true);
      expect(saveNotificationPreferences).toHaveBeenLastCalledWith(expect.objectContaining({
        enabledStages: SAVED.enabledStages, quietHoursStart: '22:00', quietHoursEnd: '08:00', emailOnDelivery: true,
      }), auth);
      expect(renderHook(() => useNotificationPreferences(auth)).result.current).toMatchObject({ emailOnDelivery: true });
    }
    expect(saveNotificationPreferences).toHaveBeenCalledTimes(2);

    // Already on: nothing to save. It reads what this sign-in has read.
    const on = session();
    vi.mocked(getNotificationPreferences).mockResolvedValueOnce({ ...SAVED, emailOnDelivery: true });
    await loadNotificationPreferences(on, { once: true });
    vi.mocked(getNotificationPreferences).mockClear();
    await expect(turnOnDeliveryEmail(on)).resolves.toBe(true);
    expect(getNotificationPreferences).not.toHaveBeenCalled();

    // No email from this server, or none to this account: it stays without.
    vi.mocked(getNotificationPreferences).mockResolvedValueOnce({ ...SAVED, emailAvailable: false });
    await expect(turnOnDeliveryEmail(session())).resolves.toBe(false);
    expect(saveNotificationPreferences).toHaveBeenCalledTimes(2);

    // A save the server did not keep is not reported as on, and a failure is the caller's to hear.
    vi.mocked(saveNotificationPreferences).mockResolvedValueOnce({ ...SAVED, emailOnDelivery: false });
    await expect(turnOnDeliveryEmail(session())).resolves.toBe(false);
    vi.mocked(saveNotificationPreferences).mockRejectedValueOnce(new Error('offline'));
    await expect(turnOnDeliveryEmail(session())).rejects.toThrow('offline');
  });

  it('saves the events without the email choice, so the server keeps it', async () => {
    const auth = session();
    vi.mocked(getNotificationPreferences).mockResolvedValue({ ...SAVED, emailOnDelivery: true });
    await loadNotificationPreferences(auth);
    vi.mocked(saveNotificationPreferences).mockResolvedValueOnce({ ...SAVED, enabledStages: ['delivered'], emailOnDelivery: true });
    await saveNotificationStages(['delivered'], auth);
    const [sent] = vi.mocked(saveNotificationPreferences).mock.calls[0];
    expect(sent).toEqual({ enabledStages: ['delivered'], quietHoursStart: null, quietHoursEnd: null, timezone: expect.any(String) });
    expect(sent).not.toHaveProperty('emailOnDelivery');
    expect(sent).not.toHaveProperty('emailAvailable');
    expect(renderHook(() => useNotificationPreferences(auth)).result.current).toMatchObject({ enabledStages: ['delivered'], emailOnDelivery: true });
  });

  it('does not let a read that began before a save undo it', async () => {
    const auth = session();
    await loadNotificationPreferences(auth);
    let answer!: (preferences: NotificationPreferences) => void;
    vi.mocked(getNotificationPreferences).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const reading = loadNotificationPreferences(auth);
    await saveEmailOnDelivery(true, auth);
    answer(SAVED);
    await expect(reading).resolves.toMatchObject({ emailOnDelivery: true });
    expect(renderHook(() => useNotificationPreferences(auth)).result.current).toMatchObject({ emailOnDelivery: true });
  });
});

describe('the delivery email of an account', () => {
  const ADDRESS = 'alex@example.com';
  const read = async (preferences: Partial<NotificationPreferences>, address: string | undefined) => {
    const auth = session();
    vi.mocked(getNotificationPreferences).mockResolvedValue({ ...SAVED, ...preferences });
    await loadNotificationPreferences(auth);
    return renderHook(() => useDeliveryEmail(auth, address)).result.current;
  };

  it('is there only when the server can write to the account and the session names the address', async () => {
    expect(await read({ emailOnDelivery: true }, ADDRESS)).toEqual({ address: ADDRESS, choice: true });
    expect(await read({ emailOnDelivery: false }, ADDRESS)).toEqual({ address: ADDRESS, choice: false });
    expect(await read({ emailOnDelivery: null }, ADDRESS)).toEqual({ address: ADDRESS, choice: null });
    expect(await read({ emailAvailable: false, emailOnDelivery: true }, ADDRESS)).toBeNull();
    // A server from before the email says nothing about it.
    expect(await read({ emailAvailable: undefined, emailOnDelivery: undefined }, ADDRESS)).toBeNull();
    expect(await read({}, undefined)).toBeNull();
    // The account menu shows a word in place of a missing address; it is not one.
    expect(await read({}, 'Account')).toBeNull();
    // Nothing shows before the preferences are read, nor without an account.
    expect(renderHook(() => useDeliveryEmail(session(), ADDRESS)).result.current).toBeNull();
    expect(renderHook(() => useDeliveryEmail(undefined, ADDRESS)).result.current).toBeNull();
  });

  it('counts a missing choice as off, never as “never chosen”', async () => {
    expect(await read({ emailOnDelivery: undefined }, ADDRESS)).toEqual({ address: ADDRESS, choice: false });
  });
});
