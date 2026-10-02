import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyticsConfiguration, analyticsConfigurationFor } from './analytics';
import { GET } from '../../app/api/analytics/config/route';
const env = { NODE_ENV: 'production', UMAMI_URL: 'https://u.example', UMAMI_APP_ORIGIN: 'https://delivery.example',
  UMAMI_WEBSITE_ID: '1802c52e-466b-47e6-ac7f-f5a497655b1b', UMAMI_IOS_WEBSITE_ID: '2802c52e-466b-47e6-ac7f-f5a497655b1b' } as NodeJS.ProcessEnv;
afterEach(() => { vi.unstubAllEnvs(); });
describe('runtime analytics configuration', () => {
  it('requires complete opt-in configuration and production', () => {
    expect(analyticsConfiguration({} as NodeJS.ProcessEnv)).toBeNull();
    expect(analyticsConfiguration({ ...env, NODE_ENV: 'development' })).toBeNull();
    expect(analyticsConfiguration({ ...env, UMAMI_IOS_WEBSITE_ID: '' })).toBeNull();
    expect(analyticsConfiguration(env)).toEqual({ endpoint: 'https://u.example/api/send', hostname: 'delivery.example',
      webWebsite: env.UMAMI_WEBSITE_ID, iosWebsite: env.UMAMI_IOS_WEBSITE_ID });
  });
  it.each(['http://u.example', 'https://password@u.example', 'https://u.example/?secret=x', 'https://u.example/path', 'https://u.example/#token'])('rejects unsafe or ambiguous origins %s', (url) => {
    expect(analyticsConfiguration({ ...env, UMAMI_URL: url })).toBeNull();
    expect(analyticsConfiguration({ ...env, UMAMI_APP_ORIGIN: url })).toBeNull();
  });
  it('does not cache configuration', () => expect(GET(new Request('https://delivery.example/api/analytics/config')).headers.get('Cache-Control')).toBe('no-store'));

  it('answers a host the site moved from with its own name, so apps that still call it keep reporting', async () => {
    const moved = { ...env, UMAMI_APP_ORIGIN: 'https://peek.example', CANONICAL_ORIGIN: 'https://peek.example', LEGACY_HOSTS: 'delivery.example' };
    const asked = (host: string, environment: NodeJS.ProcessEnv = moved) => analyticsConfigurationFor(new Headers({ host }), environment)?.hostname;
    expect(asked('peek.example')).toBe('peek.example');
    expect(asked('delivery.example')).toBe('delivery.example');
    expect(asked('DELIVERY.example:443')).toBe('delivery.example');
    // Any other host is told the instance's own name, and its clients stay off.
    expect(asked('preview.example')).toBe('peek.example');
    // Analytics that belong to another origin than the site's are not lent to its legacy hosts.
    expect(asked('delivery.example', { ...moved, UMAMI_APP_ORIGIN: 'https://other.example' })).toBe('other.example');
    expect(asked('delivery.example', env)).toBe('delivery.example');
    expect(analyticsConfigurationFor(new Headers({ host: 'delivery.example' }), { ...moved, NODE_ENV: 'development' })).toBeNull();

    for (const [key, value] of Object.entries(moved)) vi.stubEnv(key, value);
    const response = GET(new Request('https://delivery.example/api/analytics/config', { headers: { host: 'delivery.example' } }));
    expect(await response.json()).toMatchObject({ hostname: 'delivery.example', endpoint: 'https://u.example/api/send' });
  });
});
