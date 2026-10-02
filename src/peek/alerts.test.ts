import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPHONE_SAFARI, restoreAlertBrowser, stubAlertBrowser, TEST_PUSH_ENDPOINT, TEST_PUSH_KEY } from '../test/alertBrowser';
import { LINK_ID, OWNER_KEY } from '../test/parcelLinks';
import { AlertError, alertSupport, deviceAlert, turnOffAlert, turnOnAlert } from './alerts';
import { forgetAllLinkNotes, linkNote, noteLink } from './deviceNotes';
import { ParcelLinkError } from './links';

const mocks = vi.hoisted(() => ({ set: vi.fn(), remove: vi.fn() }));
vi.mock('./links', async (original) => ({
  ...await original<typeof import('./links')>(),
  setParcelAlert: mocks.set,
  removeParcelAlert: mocks.remove,
}));

const SERVER = { available: true, vapidPublicKey: TEST_PUSH_KEY };
const DEMO = { available: true, vapidPublicKey: null };
const ENDPOINT = TEST_PUSH_ENDPOINT;
const IPHONE = IPHONE_SAFARI;
const browser = stubAlertBrowser;

const turnOn = (overrides: Partial<Parameters<typeof turnOnAlert>[0]> = {}) =>
  turnOnAlert({ linkId: LINK_ID, key: null, alerts: SERVER, preset: 'important', locale: 'de', ...overrides });
const failed = async (operation: Promise<unknown>) => operation.then(() => null, (reason: unknown) => reason);

beforeEach(() => {
  mocks.set.mockReset().mockResolvedValue(undefined);
  mocks.remove.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  restoreAlertBrowser();
  forgetAllLinkNotes();
});

describe('what a browser can do about alerts', () => {
  it('says so without asking the browser anything', () => {
    const { requestPermission, pushManager } = browser();
    expect(alertSupport(SERVER)).toBe('ready');
    expect(alertSupport(DEMO)).toBe('ready');
    expect(alertSupport({ available: false, vapidPublicKey: null })).toBe('unavailable');
    expect(alertSupport(undefined)).toBe('unavailable');
    expect(requestPermission).not.toHaveBeenCalled();
    expect(pushManager.getSubscription).not.toHaveBeenCalled();
  });

  it('knows a refusal, and a browser without notifications or without push', () => {
    browser({ permission: 'denied' });
    expect(alertSupport(SERVER)).toBe('blocked');
    vi.stubGlobal('PushManager', undefined);
    // The demo's alerts need no push service; the server's do.
    expect(alertSupport(SERVER)).toBe('unsupported');
    expect(alertSupport(DEMO)).toBe('blocked');
    vi.stubGlobal('Notification', undefined);
    expect(alertSupport(DEMO)).toBe('unsupported');
  });

  it('sends an iPhone outside a Home Screen app to the steps, and lets one inside it through', () => {
    browser({ userAgent: IPHONE });
    expect(alertSupport(SERVER)).toBe('install');
    // Where the server sends nothing, the steps would lead nowhere.
    expect(alertSupport({ available: false, vapidPublicKey: null })).toBe('unavailable');
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    expect(alertSupport(SERVER)).toBe('ready');
  });
});

describe('turning alerts on', () => {
  it('asks for permission, subscribes with the server’s key and tells the server, with the page’s language and the preset', async () => {
    const { requestPermission, pushManager } = browser();
    const alert = await turnOn({ key: OWNER_KEY });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).toHaveBeenCalledExactlyOnceWith({ userVisibleOnly: true, applicationServerKey: expect.any(ArrayBuffer) });
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith(LINK_ID, {
      subscription: { endpoint: ENDPOINT, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } }, preset: 'important', locale: 'de',
    }, OWNER_KEY);
    expect(alert).toEqual({ preset: 'important', endpoint: ENDPOINT });
    expect(linkNote(LINK_ID).alert).toEqual(alert);
  });

  it('reuses the browser’s subscription and does not ask again once allowed: changing the preset is the same request', async () => {
    const { requestPermission, pushManager } = browser({ permission: 'granted', existing: true });
    await turnOn();
    await turnOn({ preset: 'delivery' });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(mocks.set).toHaveBeenLastCalledWith(LINK_ID, expect.objectContaining({ preset: 'delivery' }), null);
    expect(linkNote(LINK_ID).alert).toEqual({ preset: 'delivery', endpoint: ENDPOINT });
  });

  it('stops at a refusal or a closed prompt, before any subscription', async () => {
    const denied = browser({ answer: 'denied' });
    expect(await failed(turnOn())).toMatchObject({ name: 'AlertError', kind: 'blocked' });
    expect(denied.pushManager.subscribe).not.toHaveBeenCalled();
    const closed = browser({ answer: 'default' });
    expect(await failed(turnOn())).toMatchObject({ kind: 'dismissed' });
    expect(closed.pushManager.getSubscription).not.toHaveBeenCalled();
    // Already refused: the browser is not asked again.
    const blocked = browser({ permission: 'denied' });
    expect(await failed(turnOn())).toMatchObject({ kind: 'blocked' });
    expect(blocked.requestPermission).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(linkNote(LINK_ID).alert).toBeUndefined();
  });

  it('does not ask where it cannot work: no server push, or an iPhone outside its Home Screen app', async () => {
    const { requestPermission } = browser();
    expect(await failed(turnOn({ alerts: { available: false, vapidPublicKey: null } }))).toMatchObject({ kind: 'unsupported' });
    browser({ userAgent: IPHONE });
    expect(await failed(turnOn())).toMatchObject({ kind: 'unsupported' });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('gives up on a service worker that never gets ready, and on a subscription the browser refuses', async () => {
    vi.useFakeTimers();
    browser({ ready: false });
    const waiting = failed(turnOn());
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await waiting).toMatchObject({ name: 'AlertError', kind: 'unsupported' });
    vi.useRealTimers();
    const { pushManager } = browser();
    pushManager.subscribe.mockRejectedValueOnce(new DOMException('Registration failed', 'AbortError'));
    expect(await failed(turnOn())).toMatchObject({ kind: 'failed' });
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('passes the server’s refusal on, and drops a subscription it made only for this alert', async () => {
    const fresh = browser();
    mocks.set.mockRejectedValueOnce(new ParcelLinkError('full'));
    expect(await failed(turnOn())).toMatchObject({ kind: 'full' });
    expect(fresh.subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(linkNote(LINK_ID).alert).toBeUndefined();
    // A subscription that was there before belongs to other parcels or an account too: it stays.
    const kept = browser({ permission: 'granted', existing: true });
    mocks.set.mockRejectedValueOnce(new ParcelLinkError('unconfigured'));
    const refusal = await failed(turnOn());
    expect(refusal).toBeInstanceOf(ParcelLinkError);
    expect(refusal).not.toBeInstanceOf(AlertError);
    expect(kept.subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it('in the demo asks for permission and remembers the alert, without a push service', async () => {
    const { requestPermission, pushManager } = browser();
    const alert = await turnOn({ alerts: DEMO, preset: 'all', locale: 'en' });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(alert.endpoint).toMatch(/^demo:/);
    expect(mocks.set).toHaveBeenCalledWith(LINK_ID, { subscription: { endpoint: alert.endpoint, keys: { p256dh: 'demo', auth: 'demo' } }, preset: 'all', locale: 'en' }, null);
    // Changing the preset keeps the same stand-in address.
    expect((await turnOn({ alerts: DEMO, preset: 'delivery' })).endpoint).toBe(alert.endpoint);
  });
});

describe('the alert a browser has', () => {
  it('is the noted one while the browser still allows it and holds the same subscription', async () => {
    browser({ permission: 'granted', existing: true });
    expect(await deviceAlert(LINK_ID)).toBeNull();
    noteLink(LINK_ID, { alert: { preset: 'all', endpoint: ENDPOINT } });
    expect(await deviceAlert(LINK_ID)).toEqual({ preset: 'all', endpoint: ENDPOINT });
  });

  it('is gone once the permission is withdrawn or the subscription changed, whatever was noted', async () => {
    const granted = browser({ permission: 'granted', existing: true });
    noteLink(LINK_ID, { alert: { preset: 'all', endpoint: ENDPOINT } });
    granted.drop();
    expect(await deviceAlert(LINK_ID)).toBeNull();
    expect(linkNote(LINK_ID).alert).toBeUndefined();

    noteLink(LINK_ID, { alert: { preset: 'all', endpoint: ENDPOINT } });
    browser({ permission: 'denied', existing: true });
    expect(await deviceAlert(LINK_ID)).toBeNull();
    expect(linkNote(LINK_ID).alert).toBeUndefined();

    // A demo alert has no subscription to compare: the permission alone decides.
    noteLink(LINK_ID, { alert: { preset: 'all', endpoint: 'demo:1' } });
    browser({ permission: 'granted' });
    expect(await deviceAlert(LINK_ID)).toEqual({ preset: 'all', endpoint: 'demo:1' });
  });

  it('turns off on the server and on the device, leaving the browser’s subscription for its other uses', async () => {
    const { subscription } = browser({ permission: 'granted', existing: true });
    await turnOffAlert(LINK_ID);
    expect(mocks.remove).not.toHaveBeenCalled();
    noteLink(LINK_ID, { alert: { preset: 'all', endpoint: ENDPOINT } });
    await turnOffAlert(LINK_ID);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(LINK_ID, ENDPOINT);
    expect(linkNote(LINK_ID).alert).toBeUndefined();
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    // A server that cannot be reached leaves the alert noted: it is still on.
    noteLink(LINK_ID, { alert: { preset: 'all', endpoint: ENDPOINT } });
    mocks.remove.mockRejectedValueOnce(new ParcelLinkError('offline'));
    await expect(turnOffAlert(LINK_ID)).rejects.toMatchObject({ kind: 'offline' });
    expect(linkNote(LINK_ID).alert).toBeDefined();
  });
});
