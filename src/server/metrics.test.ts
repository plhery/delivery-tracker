import { describe, expect, it, vi } from 'vitest';

vi.mock('./stepRecorder', () => ({ addStepRecorder: vi.fn() }));

const metrics = await import('./metrics');

describe('prometheus carrier metrics', () => {
  it('records steps, fallbacks and lookups with low-cardinality labels', async () => {
    metrics.prometheusStepRecorder.step({
      carrier: 'ups', step: 'direct', attempt: 1, outcome: 'challenge', errorType: 'ChallengeError', durationMs: 250,
      fallbackFrom: null, fallbackReason: null, fallbackErrorType: null,
    });
    metrics.prometheusStepRecorder.step({
      carrier: 'ups', step: 'trawl', attempt: 2, outcome: 'ok', errorType: null, durationMs: 4000,
      fallbackFrom: 'direct', fallbackReason: 'challenge', fallbackErrorType: 'ChallengeError',
    });
    metrics.prometheusStepRecorder.lookup({ carrier: 'ups', finalStep: 'trawl', outcome: 'ok', errorType: null, durationMs: 4300, attempts: 2 });
    metrics.recordStatusMapping('ups', 'wording:delivered');
    metrics.recordStatusMapping('ups', 'carrier_map');
    metrics.recordDetection('high');
    const text = await metrics.metricsText();
    expect(text).toContain('carrier_step_total{carrier="ups",step="direct",outcome="challenge",error_type="ChallengeError"} 1');
    expect(text).toContain('carrier_fallback_total{carrier="ups",from_step="direct",to_step="trawl",reason="challenge"} 1');
    expect(text).toContain('carrier_lookup_total{carrier="ups",final_step="trawl",outcome="ok"} 1');
    expect(text).toContain('carrier_status_mapping_total{carrier="ups",stage_source="wording"} 1');
    expect(text).toContain('carrier_status_mapping_total{carrier="ups",stage_source="carrier_map"} 1');
    expect(text).toContain('carrier_detection_total{result="high"} 1');
    expect(text).toContain('carrier_step_duration_seconds_bucket{le="0.25",carrier="ups",step="direct",outcome="challenge"} 1');
  });

  it('only exposes the endpoint with a reasonably long token', () => {
    expect(metrics.metricsToken({})).toBeNull();
    expect(metrics.metricsToken({ METRICS_TOKEN: 'short' })).toBeNull();
    expect(metrics.metricsToken({ METRICS_TOKEN: ' a-token-of-sixteen-chars ' })).toBe('a-token-of-sixteen-chars');
  });
});
