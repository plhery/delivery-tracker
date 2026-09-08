import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invitationSocialNickname } from './invitationSocial';
import { friendsAction, invitationPreviewByHash } from './friends';
import { SupabaseServiceClient } from './supabase';
import { generateMetadata } from '../../app/invite/page';
import { generateMetadata as shortMetadata } from '../../app/i/[previewId]/page';

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers({ host: 'delivery.example.test', 'x-forwarded-proto': 'https' })) }));

const code = 'ab'.repeat(16);
const preview = createHash('sha256').update(code).digest('hex');
const sender = [{ friend_profiles: { nickname: 'Paul', email: 'private@example.test', parcels: ['private'] } }];
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('renders personalized Open Graph and Twitter metadata using only a read-only hash', async () => {
  const request = vi.spyOn(SupabaseServiceClient.prototype, 'request').mockResolvedValue(sender);
  const metadata = await generateMetadata({ searchParams: Promise.resolve({ preview }) });
  const url = `https://delivery.example.test/invite?preview=${preview}`;
  const image = `https://delivery.example.test/api/friends/invite-image?preview=${preview}`;
  const title = 'Your friend Paul sent you an invitation';
  expect(metadata).toMatchObject({
    title, robots: { index: false, follow: false }, referrer: 'no-referrer',
    alternates: { canonical: url },
    openGraph: { title, url, images: [{ url: image, width: 1200, height: 630, type: 'image/png', alt: title }] },
    twitter: { title, card: 'summary_large_image', images: [{ url: image, alt: title }] },
  });
  expect(JSON.stringify(metadata)).not.toMatch(new RegExp(`${code}|private@example|parcels`));
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]).toHaveLength(1); // GET only; never accept or consume.
  const query = new URL(request.mock.calls[0][0], 'https://database.example').searchParams;
  expect(query.get('select')).toBe('friend_profiles!inner(nickname)');
  expect(query.get('code_hash')).toBe(`eq.${preview}`);
  expect(query.get('expires_at')).toMatch(/^gt\.\d{4}-/);
});

it.each([undefined, code, 'bad', [preview, preview]])('uses generic metadata for absent or malformed preview keys: %s', async (value) => {
  const request = vi.spyOn(SupabaseServiceClient.prototype, 'request');
  const metadata = await generateMetadata({ searchParams: Promise.resolve({ preview: value, nickname: 'Spoofed' }) });
  expect(metadata.title).toBe('A friend sent you an invitation');
  expect(JSON.stringify(metadata)).not.toContain('Spoofed');
  expect(metadata.alternates?.canonical).toBe('https://delivery.example.test/invite');
  expect(request).not.toHaveBeenCalled();
});

it('keeps expired, revoked, consumed and unknown invitations generic without breaking the page', async () => {
  vi.spyOn(SupabaseServiceClient.prototype, 'request').mockResolvedValue([]);
  const metadata = await generateMetadata({ searchParams: Promise.resolve({ preview }) });
  expect(metadata.title).toBe('A friend sent you an invitation');
  expect(metadata.openGraph).toMatchObject({ url: `https://delivery.example.test/invite?preview=${preview}` });
});

it('falls back when the database is unavailable or the profile is corrupt', async () => {
  const request = vi.spyOn(SupabaseServiceClient.prototype, 'request').mockRejectedValue(new Error('Offline'));
  expect(await invitationSocialNickname(preview, new Headers())).toBeNull();
  request.mockResolvedValue([{ friend_profiles: { nickname: '\nUnsafe' } }]);
  expect(await invitationSocialNickname(preview, new Headers())).toBeNull();
});

it('limits anonymous lookups across HTML and image previews', async () => {
  const request = vi.spyOn(SupabaseServiceClient.prototype, 'request').mockResolvedValue(sender);
  const headers = new Headers({ 'x-real-ip': '198.51.100.22' });
  for (let i = 0; i < 60; i++) expect(await invitationSocialNickname(preview, headers)).toBe('Paul');
  expect(await invitationSocialNickname(preview, headers)).toBeNull();
  expect(request).toHaveBeenCalledTimes(60);
});

it('keeps preview hashes and acceptance tokens non-interchangeable', async () => {
  expect(() => friendsAction({ action: 'accept_invite', code: preview })).toThrow();
  const client = new SupabaseServiceClient('https://database.example', 'test-service-key');
  const request = vi.spyOn(client, 'request');
  await expect(invitationPreviewByHash(client, code)).rejects.toMatchObject({ status: 400 });
  expect(request).not.toHaveBeenCalled();
});

it('uses a short, independent ID for both crawler metadata and the nickname lookup', async () => {
  const previewId = 'Ab7kP2mQ9xR4tY6n';
  const request = vi.spyOn(SupabaseServiceClient.prototype, 'request').mockResolvedValue(sender);
  const metadata = await shortMetadata({ params: Promise.resolve({ previewId }) });
  expect(metadata).toMatchObject({
    title: 'Your friend Paul sent you an invitation',
    description: 'Tap to open your invitation on Delivery Tracker.',
    alternates: { canonical: `https://delivery.example.test/i/${previewId}` },
    openGraph: { url: `https://delivery.example.test/i/${previewId}`, images: [{ url: `https://delivery.example.test/api/friends/invite-image?preview=${previewId}` }] },
  });
  const query = new URL(request.mock.calls[0][0], 'https://database.example').searchParams;
  expect(query.get('preview_id')).toBe(`eq.${previewId}`);
  expect(query.has('code_hash')).toBe(false);
  expect(query.get('select')).toBe('friend_profiles!inner(nickname)');
  expect(query.get('expires_at')).toMatch(/^gt\.\d{4}-/);
  expect(JSON.stringify(metadata)).not.toContain(code);
  expect(request.mock.calls[0]).toHaveLength(1);
  expect(() => friendsAction({ action: 'accept_invite', code: previewId })).toThrow();
});
it('treats malformed and unavailable short IDs as generic previews', async () => {
  const request = vi.spyOn(SupabaseServiceClient.prototype, 'request').mockResolvedValue([]);
  expect((await shortMetadata({ params: Promise.resolve({ previewId: preview }) })).title).toBe('A friend sent you an invitation');
  expect(request).not.toHaveBeenCalled();
  expect((await shortMetadata({ params: Promise.resolve({ previewId: 'Ab7kP2mQ9xR4tY6n' }) })).title).toBe('A friend sent you an invitation');
  expect(request).toHaveBeenCalledTimes(1);
});
