import { describe, expect, it } from 'vitest';
import { analyticsConfiguration } from './analytics';
import { GET } from '../../app/api/analytics/config/route';
const env = { NODE_ENV: 'production', UMAMI_URL: 'https://u.example', UMAMI_APP_ORIGIN: 'https://delivery.example',
  UMAMI_WEBSITE_ID: '1802c52e-466b-47e6-ac7f-f5a497655b1b', UMAMI_IOS_WEBSITE_ID: '2802c52e-466b-47e6-ac7f-f5a497655b1b' } as NodeJS.ProcessEnv;
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
  it('does not cache configuration', () => expect(GET().headers.get('Cache-Control')).toBe('no-store'));
});
