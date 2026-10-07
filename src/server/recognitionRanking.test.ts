import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const filesystem = vi.hoisted(() => ({ readFileSync: vi.fn(), statSync: vi.fn() }));
vi.mock('node:fs', () => filesystem);

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('CARRIER_RECOGNITION_PRIORITIES_PATH', '/private/aggregate-ranking.json');
  filesystem.readFileSync.mockReset();
  filesystem.statSync.mockReset().mockReturnValue({ size: 100 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('private aggregate recognition priorities', () => {
  it('loads coarse shapes and known finite carrier scores without retaining identifier characters', async () => {
    filesystem.readFileSync.mockReturnValue(JSON.stringify({ version: 1, cohorts: {
      D14: { dpd: 25, 'dhl-ecommerce-uk': 5, 'made-up-carrier': 90, brt: -1, seur: '30' },
      '12345678901234': { dpd: 80 },
      A2D9A2: { chronopost: 25 },
      D41: { dpd: 30 }, A2A2: { dpd: 30 }, D0: { dpd: 30 },
    } }));
    const { getRecognitionPriorities } = await import('./recognitionRanking');
    expect(getRecognitionPriorities('12345678901231')).toEqual({ dpd: 25, 'dhl-ecommerce-uk': 5 });
    expect(getRecognitionPriorities('AB123456789XY')).toEqual({ chronopost: 25 });
    expect(getRecognitionPriorities('12345')).toBeUndefined();
    expect(getRecognitionPriorities('invalid?')).toBeUndefined();
  });

  it('leaves defaults intact for missing, malformed, oversized or unsupported files', async () => {
    const { getRecognitionPriorities } = await import('./recognitionRanking');
    for (const [index, value] of ['{', '{}', '{"version":2,"cohorts":{"D14":{"dpd":20}}}'].entries()) {
      vi.stubEnv('CARRIER_RECOGNITION_PRIORITIES_PATH', `/private/aggregate-${index}.json`);
      filesystem.readFileSync.mockReturnValue(value);
      expect(getRecognitionPriorities('12345678901231')).toBeUndefined();
    }
    vi.stubEnv('CARRIER_RECOGNITION_PRIORITIES_PATH', '/private/large.json');
    filesystem.statSync.mockReturnValue({ size: 256 * 1024 + 1 });
    expect(getRecognitionPriorities('12345678901231')).toBeUndefined();
    vi.stubEnv('CARRIER_RECOGNITION_PRIORITIES_PATH', '/private/missing.json');
    filesystem.statSync.mockImplementation(() => { throw new Error('missing'); });
    expect(getRecognitionPriorities('12345678901231')).toBeUndefined();
    vi.stubEnv('CARRIER_RECOGNITION_PRIORITIES_PATH', '');
    expect(getRecognitionPriorities('12345678901231')).toBeUndefined();
  });

  it('bounds file reads and reloads updated evidence', async () => {
    vi.useFakeTimers();
    filesystem.readFileSync.mockReturnValue('{"version":1,"cohorts":{"D14":{"dpd":20}}}');
    const { getRecognitionPriorities } = await import('./recognitionRanking');
    expect(getRecognitionPriorities('12345678901231')).toEqual({ dpd: 20 });
    expect(getRecognitionPriorities('00000000000001')).toEqual({ dpd: 20 });
    expect(filesystem.readFileSync).toHaveBeenCalledTimes(1);
    filesystem.readFileSync.mockReturnValue('{"version":1,"cohorts":{"D14":{"dpd":30}}}');
    vi.advanceTimersByTime(5 * 60_000);
    expect(getRecognitionPriorities('12345678901231')).toEqual({ dpd: 30 });
    expect(filesystem.readFileSync).toHaveBeenCalledTimes(2);
  });
});
