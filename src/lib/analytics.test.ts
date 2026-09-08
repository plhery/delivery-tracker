// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://delivery.example/"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import catalog from '../../shared/analytics.json';

const config = { endpoint: 'https://analytics.example/api/send', hostname: 'delivery.example',
  webWebsite: '1802c52e-466b-47e6-ac7f-f5a497655b1b', iosWebsite: '2802c52e-466b-47e6-ac7f-f5a497655b1b' };
let requests: { url: string; init?: RequestInit }[];
beforeEach(() => {
  vi.resetModules(); localStorage.clear(); requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    return Response.json(url === '/api/analytics/config' ? config : { cache: 'session-cache' });
  }));
});
afterEach(() => vi.unstubAllGlobals());
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('safe analytics collection', () => {
  it('tracks queued views and actions without leaking URL, user content, or identifiers', async () => {
    history.replaceState(null, '', '/?parcel=private-id&code=secret#invitation-secret');
    const a = await import('./analytics');
    a.trackScreen('parcel', 'account');
    a.trackAction('parcel-rename', 'success');
    a.trackAction('secret tracking number');
    a.trackScreen('/?token=secret');
    await a.startAnalytics(); await settle();
    const sent = requests.filter((r) => r.url === config.endpoint);
    expect(sent).toHaveLength(3); // one view, rename, app-open
    for (const request of sent) {
      expect(request.init?.credentials).toBe('omit');
      expect(request.init?.referrerPolicy).toBe('no-referrer');
      const payload = JSON.parse(request.init!.body as string).payload;
      expect(payload.url).toBe('/parcel');
      expect(payload.data.mode).toBe('account');
      expect(payload).not.toHaveProperty('id');
      expect(payload).not.toHaveProperty('referrer');
      expect(request.init!.body).not.toMatch(/secret|private-id|token/);
    }
    expect(sent[1].init?.headers).toHaveProperty('x-umami-cache', 'session-cache');
    a.trackScreen('parcel', 'account'); await settle();
    expect(requests.filter((r) => r.url === config.endpoint)).toHaveLength(3);
  });

  it.each(['opt-out', 'dnt', 'gpc'])('honors %s without fetching configuration', async (kind) => {
    if (kind === 'opt-out') localStorage.setItem('sdt.analytics.enabled', 'false');
    else vi.stubGlobal('navigator', kind === 'dnt' ? { doNotTrack: '1' } : { globalPrivacyControl: true });
    const a = await import('./analytics');
    a.trackScreen('welcome'); await a.startAnalytics(); a.trackAction('app-open'); await settle();
    expect(requests).toEqual([]);
  });

  it('stops queued events after opting out and does not send the opt-out itself', async () => {
    const a = await import('./analytics'); await a.startAnalytics(); await settle();
    const count = requests.length;
    a.setAnalyticsEnabled(false); a.trackAction('parcel-delete', 'success'); await settle();
    expect(requests).toHaveLength(count);
  });

  it.each([null, { ...config, hostname: 'some-other-host.example' }, { ...config, endpoint: 'http://unsafe.example/api/send' }])('fails closed for disabled or mismatched configuration', async (value) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(value)));
    const a = await import('./analytics'); a.trackScreen('welcome'); await a.startAnalytics();
    for (let i = 0; i < 100; i++) a.trackAction('search');
    await settle(); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('bounds the initialization queue and tolerates failed event sends', async () => {
    const a = await import('./analytics');
    for (let i = 0; i < 100; i++) a.trackAction('search');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/analytics/config') return Response.json(config);
      throw new Error('blocked analytics');
    }));
    await a.startAnalytics(); await settle();
    expect(vi.mocked(fetch).mock.calls.length).toBeLessThanOrEqual(31);
    a.trackAction('parcel-add', 'success'); await settle(); // no rejected promise or app failure
  });
});

describe('action mapping shared with native', () => {
  it('maps every declared API action, excludes polling, and never returns private input', async () => {
    const { apiAnalyticsEvent } = await import('./analytics');
    for (const rule of catalog.operations) {
      const path = rule.path.slice(1, -1).replace('[^/]+', 'private-parcel-id');
      expect(apiAnalyticsEvent(path, rule.method)).toBe(rule.event);
      expect(catalog.actions).toContain(rule.event);
    }
    for (const [action, event] of Object.entries(catalog.friendActions)) {
      expect(apiAnalyticsEvent('/api/friends', 'POST', JSON.stringify({ action, code: 'secret', nickname: 'private' }))).toBe(event);
    }
    expect(apiAnalyticsEvent('/api/friends', 'POST', '{')).toBeUndefined();
    expect(apiAnalyticsEvent('/api/friends', 'POST', '{"action":"__proto__"}')).toBeUndefined();
    expect(apiAnalyticsEvent('/api/friends', 'POST', '{"action":"preview_invite"}')).toBeUndefined();
    expect(apiAnalyticsEvent('/api/packages?includeArchived=true')).toBeUndefined();
    expect(apiAnalyticsEvent('/api/sync/jobs?ids=secret')).toBeUndefined();
    expect(apiAnalyticsEvent('/api/push/devices', 'POST', '{"token":"secret"}')).toBeUndefined();
  });
});
