import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../app/.well-known/apple-app-site-association/route';
import { config } from '../../proxy';
import { appleAppIds, appleAppSiteAssociation } from './appleAppLinks';

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

afterEach(() => { vi.unstubAllEnvs(); });

describe('appleAppIds', () => {
  it('names the app that receives the push notifications', () => {
    expect(appleAppIds(env({ APNS_TEAM_ID: 'ABCDE12345', APNS_BUNDLE_ID: 'com.example.Peek' }))).toEqual(['ABCDE12345.com.example.Peek']);
  });

  it('prefers the listed apps, which need no push configuration', () => {
    expect(appleAppIds(env({
      APPLE_APP_IDS: ' ABCDE12345.com.example.Peek , FGHIJ67890.com.example.Peek.beta, ABCDE12345.com.example.Peek ',
      APNS_TEAM_ID: 'ZZZZZ99999', APNS_BUNDLE_ID: 'com.example.Other',
    }))).toEqual(['ABCDE12345.com.example.Peek', 'FGHIJ67890.com.example.Peek.beta']);
  });

  it('has no app without a team, a bundle id or a well-formed id', () => {
    expect(appleAppIds(env({}))).toEqual([]);
    expect(appleAppIds(env({ APNS_TEAM_ID: 'ABCDE12345' }))).toEqual([]);
    expect(appleAppIds(env({ APNS_BUNDLE_ID: 'com.example.Peek' }))).toEqual([]);
    expect(appleAppIds(env({ APPLE_APP_IDS: 'com.example.Peek, short.com.example.Peek, ABCDE12345.com/example' }))).toEqual([]);
  });
});

describe('the app site association', () => {
  it('opens parcel links and invitations in the app, and nothing else', () => {
    expect(appleAppSiteAssociation(env({ APPLE_APP_IDS: 'ABCDE12345.com.example.Peek' }))).toEqual({
      applinks: {
        details: [{
          appIDs: ['ABCDE12345.com.example.Peek'],
          components: [{ '/': '/p/*' }, { '/': '/i/*' }, { '/': '/invite' }],
        }],
      },
    });
    expect(appleAppSiteAssociation(env({}))).toBeNull();
  });

  it('is served as cacheable JSON, without a session', async () => {
    vi.stubEnv('APPLE_APP_IDS', 'ABCDE12345.com.example.Peek');
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(response.headers.get('content-security-policy')).toBeNull();
    expect((await response.json()).applinks.details[0].appIDs).toEqual(['ABCDE12345.com.example.Peek']);
  });

  it('does not exist until an app is configured', async () => {
    vi.stubEnv('APPLE_APP_IDS', '');
    vi.stubEnv('APNS_TEAM_ID', '');
    vi.stubEnv('APNS_BUNDLE_ID', '');
    const response = GET();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });

  it('is left alone by the page proxy, which would mark it private and give it a page policy', () => {
    const pages = new RegExp(`^${config.matcher[0].source}$`);
    expect(pages.test('/.well-known/apple-app-site-association')).toBe(false);
    // Anything else under .well-known is a page that does not exist.
    expect(pages.test('/.well-known/assetlinks.json')).toBe(true);
    expect(pages.test('/p/k7Qm2xW9bTfR')).toBe(true);
    expect(pages.test('/demo')).toBe(true);
  });
});
