import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const revoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('./runtime', () => ({ serviceClient: () => ({ revokeLiveActivityDevice: revoke }) }));
vi.mock('./observability', () => ({ captureOperationalError: vi.fn(), logOperationalEvent: vi.fn() }));
import { POST } from '../../app/api/live-activities/revoke/route';

beforeEach(() => revoke.mockClear());
afterEach(() => vi.restoreAllMocks());
const installationId = '96000000-0000-0000-0000-000000000005';
function request(body: unknown) {
  return new NextRequest('https://delivery.test/api/live-activities/revoke', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
it('accepts a deletion capability after sign-out and passes only its hash to SQL', async () => {
  const token = '11'.repeat(32);
  const response = await POST(request({ installationId, revocationToken: token }), { params: Promise.resolve({}) });
  expect(response.status).toBe(200);
  expect(revoke).toHaveBeenCalledWith(installationId, createHash('sha256').update(token).digest('hex'));
});
it.each([undefined, '', 'bad', 'f'.repeat(63), 'G'.repeat(64)])('rejects malformed proof %s before accessing SQL', async (revocationToken) => {
  const response = await POST(request({ installationId, revocationToken }), { params: Promise.resolve({}) });
  expect(response.status).toBe(400);
  expect(revoke).not.toHaveBeenCalled();
});
