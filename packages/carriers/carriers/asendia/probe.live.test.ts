import { describe, expect, it } from 'vitest';
import { AsendiaTracker } from './probe';

describe('Asendia live public tracking protocol', () => {
  it('reports the official Turnstile challenge instead of claiming a wrong-number lookup', async () => {
    const deliberatelyInvalidToken = `0.${'a'.repeat(64)}.${'b'.repeat(64)}`;
    await expect(new AsendiaTracker({
      turnstileTokenProvider: () => deliberatelyInvalidToken,
    }).fetch('ASE00000000')).rejects.toMatchObject({
      name: 'ChallengeError',
      kind: 'challenge',
      provider: 'Asendia',
      status: 403,
      message: 'Asendia rejected the Cloudflare Turnstile token',
    });
  });
});
