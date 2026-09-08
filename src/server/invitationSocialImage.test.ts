// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { GET } from '../../app/api/friends/invite-image/route';
import { invitationSocialImage } from './InvitationSocialImage';
import { SupabaseServiceClient } from './supabase';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it.each(['Paul', 'AlexandertheGreatestEver', 'Émilie & Léa', 'W'.repeat(24), null])('renders a complete 1200 × 630 PNG for %s', async (name) => {
  const response = invitationSocialImage(name);
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const png = Buffer.from(await response.arrayBuffer());
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
});

it('serves a crawler-accessible image through the same unexpired nickname lookup', async () => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  const request = vi.spyOn(SupabaseServiceClient.prototype, 'request').mockResolvedValue([{ friend_profiles: { nickname: 'Paul' } }]);
  const response = await GET(new Request(`https://delivery.example/api/friends/invite-image?preview=${'a'.repeat(64)}`));
  expect(response.status).toBe(200);
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  await response.arrayBuffer();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]).toHaveLength(1);
});
