import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  automaticCanaryTargets,
  canaryHealthy,
  carrierCanaryMain,
  probeCanaryTarget,
  runCanaries,
  type CanaryTarget,
} from './carrierCanary';

describe('carrier front-door canaries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const target: CanaryTarget = {
    carrierId: 'carrier',
    displayName: 'Carrier',
    url: 'https://carrier.example/public/',
  };

  it('selects only automatic carriers with privacy-safe public URLs', () => {
    expect(automaticCanaryTargets({
      automatic: {
        displayName: 'Automatic',
        tracking: { mode: 'automatic' },
        canaryUrl: 'https://carrier.example/public/',
      },
      manual: { displayName: 'Manual', tracking: { mode: 'link-only' } },
    })).toEqual([{
      carrierId: 'automatic',
      displayName: 'Automatic',
      url: 'https://carrier.example/public/',
    }]);
    for (const url of [
      'https://carrier.example/?tracking=secret',
      'https://user:password@carrier.example/',
      'http://carrier.example/',
    ]) {
      expect(() => automaticCanaryTargets({
        carrier: {
          displayName: 'Carrier',
          tracking: { mode: 'automatic' },
          canaryUrl: url,
        },
      })).toThrow('unsafe');
    }
  });

  it('retries server failures and accepts challenge responses as reachable', async () => {
    const onAttempt = vi.fn();
    const fetchStatus = vi.fn()
      .mockResolvedValueOnce(503)
      .mockResolvedValueOnce(403);
    const result = await probeCanaryTarget(target, { attempts: 2, fetchStatus, onAttempt });
    expect(canaryHealthy(result)).toBe(true);
    expect(result.status).toBe(403);
    expect(onAttempt.mock.calls.map(([, attempt]) => attempt.status)).toEqual([503, 403]);
  });

  it('reports nested connection failures for every IP without copying private error content', async () => {
    const connectionError = (address: string, code: string) => Object.assign(new Error('private-token'), {
      code, syscall: 'connect', address, port: 443,
      url: 'https://user:private-token@carrier.example/?tracking=private-token',
      headers: { Authorization: 'private-token' },
    });
    const error = new TypeError('fetch failed: private-token', {
      cause: new AggregateError([
        connectionError('192.0.2.1', 'ETIMEDOUT'),
        connectionError('2001:db8::1', 'ENETUNREACH'),
      ], 'private-token'),
    });
    const onAttempt = vi.fn();
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(10_150);
    const result = await probeCanaryTarget(target, {
      attempts: 1,
      fetchStatus: vi.fn().mockRejectedValue(error),
      onAttempt,
    });

    expect(canaryHealthy(result)).toBe(false);
    expect(result.error).toBe('TypeError');
    expect(onAttempt).toHaveBeenCalledExactlyOnceWith(target, {
      attempt: 1, maxAttempts: 1, timeoutMs: 15_000, durationMs: 10_050, status: null,
      error: {
        name: 'TypeError',
        cause: {
          name: 'AggregateError',
          errors: [
            { name: 'Error', code: 'ETIMEDOUT', syscall: 'connect', address: '192.0.2.1', port: 443 },
            { name: 'Error', code: 'ENETUNREACH', syscall: 'connect', address: '2001:db8::1', port: 443 },
          ],
        },
      },
    });
    expect(JSON.stringify(onAttempt.mock.calls)).not.toContain('private-token');
  });

  it.each([
    ['DNS', new TypeError('fetch failed', { cause: Object.assign(new Error(), { code: 'EAI_AGAIN' }) }), 'EAI_AGAIN'],
    ['TLS', new TypeError('fetch failed', { cause: Object.assign(new Error(), { code: 'CERT_HAS_EXPIRED' }) }), 'CERT_HAS_EXPIRED'],
    ['connect timeout', new TypeError('fetch failed', { cause: Object.assign(new Error(), { code: 'UND_ERR_CONNECT_TIMEOUT' }) }), 'UND_ERR_CONNECT_TIMEOUT'],
    ['request timeout', new DOMException('timed out', 'TimeoutError'), 'TimeoutError'],
  ])('preserves %s diagnostics when all attempts fail', async (_, error, expectedDetail) => {
    const onAttempt = vi.fn();
    const result = await probeCanaryTarget(target, {
      attempts: 2, fetchStatus: vi.fn().mockRejectedValue(error), onAttempt,
    });
    expect(canaryHealthy(result)).toBe(false);
    expect(onAttempt).toHaveBeenCalledTimes(2);
    for (const [, attempt] of onAttempt.mock.calls) {
      expect(attempt.status).toBeNull();
      expect(JSON.stringify(attempt.error)).toContain(expectedDetail);
    }
  });

  it('bounds cyclic and oversized error trees and rejects invalid diagnostic fields', async () => {
    const error = Object.assign(new Error('private-token'), {
      name: 'private-token', code: 'private-token', syscall: 'private-token',
      address: 'private-token', port: 70_000,
      errors: Array.from({ length: 20 }, () => new Error()),
    });
    error.cause = error;
    const onAttempt = vi.fn();
    await probeCanaryTarget(target, {
      attempts: 1, fetchStatus: vi.fn().mockRejectedValue(error), onAttempt,
    });
    const details = onAttempt.mock.calls[0]![1].error;
    expect(details.name).toBe('Error');
    expect(details.cause).toEqual({ name: 'Error', truncated: true });
    expect(details.errors).toHaveLength(8);
    expect(details.errors[7]).toEqual({ name: 'Error', truncated: true });
    expect(details.truncated).toBe(true);
    expect(details.port).toBeUndefined();
    expect(JSON.stringify(details)).not.toContain('private-token');
  });

  it('prints runtime settings and a failed attempt even when the CLI retry succeeds', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('private-token', {
        cause: Object.assign(new Error('private-token'), { code: 'ECONNRESET' }),
      }))
      .mockImplementation(async () => new Response(null, { status: 302 }));
    vi.stubGlobal('fetch', fetch);

    expect(await carrierCanaryMain(['--timeout', '3', '--attempts', '2'])).toBe(0);
    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines[0]).toContain('CANARY ');
    expect(lines[0]).toContain(process.version);
    expect(lines[0]).toContain('"timeoutMs":3000');
    const attempts = lines.filter((line) => line.startsWith('ATTEMPT swiss-post '))
      .map((line) => JSON.parse(line.slice(line.indexOf('{'))));
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      attempt: 1, maxAttempts: 2, timeoutMs: 3000, status: null,
      error: { name: 'TypeError', cause: { code: 'ECONNRESET' } },
    });
    expect(attempts[1]).toMatchObject({ attempt: 2, status: 302 });
    expect(attempts[1].error).toBeUndefined();
    expect(lines).toContain('PASS swiss-post service.post.ch HTTP 302');
    const count = automaticCanaryTargets().length;
    expect(lines.at(-1)).toBe(`${count}/${count} automatic carrier front doors reachable`);
    expect(lines.join('\n')).not.toContain('private-token');
  });

  it('caps concurrency while preserving target order', async () => {
    const targets = Array.from({ length: 10 }, (_, index) => ({
      ...target,
      carrierId: `carrier-${index}`,
    }));
    let active = 0;
    let maximum = 0;
    const fetchStatus = async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return 204;
    };
    const results = await runCanaries(targets, { attempts: 1, fetchStatus });
    expect(results.map((result) => result.target.carrierId))
      .toEqual(targets.map((item) => item.carrierId));
    expect(maximum).toBeLessThanOrEqual(6);
  });
});
