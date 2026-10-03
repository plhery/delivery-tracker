// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { GET } from '../../app/api/friends/invite-image/route';
import { refuseTheWeb } from '../test/pictureRequests';
import { invitationSocialImage } from './InvitationSocialImage';
import { SupabaseServiceClient } from './supabase';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

/** The picture of a sender's name, once it is a complete 1200 × 630 PNG. */
async function picture(name: string | null): Promise<Buffer> {
  const response = invitationSocialImage(name);
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const png = Buffer.from(await response.arrayBuffer());
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
  return png;
}

it.each(['Paul', 'AlexandertheGreatestEver', 'Émilie & Léa', 'W'.repeat(24), null])('renders a complete 1200 × 630 PNG for %s', async (name) => {
  await picture(name);
});

it.each([
  '深圳', 'Αθήνα', 'ヤマト運輸', 'مرحبا', 'shoe 👟', '🌸Léa', '👟', '🇨🇭 Zoë', 'Ünal ♥', '1\ufe0f\u20e3 one',
  // A hyphen and a space neither face has, a mark only the other face has, and initials with no capital in either.
  'Jean\u2011Luc', 'x\u202fy', 'k\u0336', 'ǰ', 'ŉ',
])('never asks the web for a font or an emoji, for a sender called %s', async (name) => {
  // The renderer fetches a font for any character its own lack, and a drawing for any emoji.
  const asked = refuseTheWeb();
  await picture(name);
  expect(asked).not.toHaveBeenCalled();
});

it('leaves an emoji out of a name, and a name it cannot write out of the picture', async () => {
  const asked = refuseTheWeb();
  const same = async (name: string | null, other: string | null) => (await picture(name)).equals(await picture(other));
  expect(await same('Léa', 'Léa')).toBe(true);
  expect(await same('Léa', 'Lea')).toBe(false);
  // The name stays, and its initial on the seal.
  for (const name of ['Léa 🌸', '🌸Léa', '🇨🇭 Léa ♥', 'Léa 1\ufe0f\u20e3', 'Le\u0301a\u202f']) expect(await same(name, 'Léa'), name).toBe(true);
  expect(await same('Léa🌸Paul', 'Léa Paul')).toBe(true);
  // A name is never misspelt: with a letter no face has, the picture is the one of an invitation without a name.
  for (const name of ['深圳', 'Αθήνα', '王 Léa', 'Le\u0336a', '👟']) expect(await same(name, null), name).toBe(true);
  // The sans has the Cyrillic letters the serif lacks.
  expect(await same('Саша', null)).toBe(false);
  expect(asked).not.toHaveBeenCalled();
});

it.each(['a'.repeat(64), 'Ab7kP2mQ9xR4tY6n'])('serves a crawler-accessible image for old and short IDs: %s', async (preview) => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  const request = vi.spyOn(SupabaseServiceClient.prototype, 'request').mockResolvedValue([{ friend_profiles: { nickname: 'Paul' } }]);
  const response = await GET(new Request(`https://delivery.example/api/friends/invite-image?preview=${preview}`));
  expect(response.status).toBe(200);
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  await response.arrayBuffer();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]).toHaveLength(1);
});
