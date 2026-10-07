import { describe, expect, it, vi } from 'vitest';

const metrics = await import('./metrics');
/** Prometheus sees a new series at 0 first; the next scrape carries its count. */
const scraped = async (source = metrics) => { await source.metricsText(); return source.metricsText(); };

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
    const text = await scraped();
    expect(text).toContain('carrier_step_total{carrier="ups",step="direct",outcome="challenge",error_type="ChallengeError"} 1');
    expect(text).toContain('carrier_fallback_total{carrier="ups",from_step="direct",to_step="trawl",reason="challenge"} 1');
    expect(text).toContain('carrier_lookup_total{carrier="ups",final_step="trawl",outcome="ok",attempts="2"} 1');
    expect(text).toContain('carrier_status_mapping_total{carrier="ups",stage_source="wording"} 1');
    expect(text).toContain('carrier_status_mapping_total{carrier="ups",stage_source="carrier_map"} 1');
    expect(text).toContain('carrier_detection_total{result="high"} 1');
    expect(text).toContain('carrier_step_duration_seconds_bucket{le="0.25",carrier="ups",step="direct",outcome="challenge"} 1');
  });

  it('serves what another bundled copy of the module recorded', async () => {
    // Next evaluates this module once per bundle: the scheduled sync records in
    // the instrumentation copy while the scrape endpoint reads its own copy.
    vi.resetModules();
    const recording = await import('./metrics');
    vi.resetModules();
    const scraping = await import('./metrics');
    expect(scraping.prometheusStepRecorder).not.toBe(recording.prometheusStepRecorder);

    recording.prometheusStepRecorder.lookup({ carrier: 'dpd', finalStep: 'direct', outcome: 'ok', errorType: null, durationMs: 400, attempts: 1 });
    recording.recordStatusMapping('dpd', 'none');
    const text = await scraped(scraping);
    expect(text).toContain('carrier_lookup_total{carrier="dpd",final_step="direct",outcome="ok",attempts="1"} 1');
    expect(text).toContain('carrier_status_mapping_total{carrier="dpd",stage_source="none"} 1');
    expect(scraping.registry).toBe(recording.registry);
  });

  it('counts who served each refresh, so provider use on a carrier with its own adapter is visible', async () => {
    expect(metrics.refreshSource('la-poste', 'la-poste')).toBe('adapter');
    expect(metrics.refreshSource('la-poste', 'unknown')).toBe('provider');
    expect(metrics.refreshSource('unknown', 'unknown')).toBe('provider');
    expect(metrics.refreshSource('dhl', 'swiss-post')).toBe('other_adapter');
    expect(metrics.refreshSource('dhl', null)).toBe('none');
    metrics.recordRefresh('la-poste', 'la-poste', 'updated');
    metrics.recordRefresh('la-poste', 'la-poste', 'updated');
    metrics.recordRefresh('la-poste', 'unknown', 'updated');
    metrics.recordRefresh('la-poste', null, 'error');
    const text = await scraped();
    expect(text).toContain('carrier_refresh_total{carrier="la-poste",served_by="adapter",outcome="updated"} 2');
    expect(text).toContain('carrier_refresh_total{carrier="la-poste",served_by="provider",outcome="updated"} 1');
    expect(text).toContain('carrier_refresh_total{carrier="la-poste",served_by="none",outcome="error"} 1');
  });

  it('labels a lookup with the attempts it took, capped to keep the label set small', async () => {
    metrics.prometheusStepRecorder.lookup({ carrier: 'la-poste', finalStep: 'retry', outcome: 'ok', errorType: null, durationMs: 3200, attempts: 3 });
    metrics.prometheusStepRecorder.lookup({ carrier: 'la-poste', finalStep: 'retry', outcome: 'challenge', errorType: 'UpstreamHttpError', durationMs: 6000, attempts: 40 });
    const text = await scraped();
    expect(text).toContain('carrier_lookup_total{carrier="la-poste",final_step="retry",outcome="ok",attempts="3"} 1');
    expect(text).toContain('carrier_lookup_total{carrier="la-poste",final_step="retry",outcome="challenge",attempts="9"} 1');
  });

  it('shows a new series at 0 before counting it, so a restart cannot hide its first update', async () => {
    // Prometheus's increase() needs a sample before the first update: a series
    // that first appears already at 1 counts nothing, after every deploy.
    const series = 'carrier_refresh_total{carrier="bpost",served_by="adapter",outcome="updated"}';
    const duration = 'carrier_step_duration_seconds_count{carrier="bpost",step="direct",outcome="ok"}';
    metrics.recordRefresh('bpost', 'bpost', 'updated');
    metrics.recordRefresh('bpost', 'bpost', 'updated');
    metrics.prometheusStepRecorder.step({ carrier: 'bpost', step: 'direct', attempt: 1, outcome: 'ok', errorType: null,
      durationMs: 300, fallbackFrom: null, fallbackReason: null, fallbackErrorType: null });
    const first = await metrics.metricsText();
    expect(first).toContain(`${series} 0`);
    expect(first).toContain(`${duration} 0`);
    const second = await metrics.metricsText();
    expect(second).toContain(`${series} 2`);
    expect(second).toContain(`${duration} 1`);
    // Once shown, a series counts at once.
    metrics.recordRefresh('bpost', 'bpost', 'updated');
    expect(await metrics.metricsText()).toContain(`${series} 3`);
  });

  it('counts lookups, link reads, kept and forgotten parcels by outcome only', async () => {
    metrics.recordPublicLookup('created');
    metrics.recordPublicLookup('created');
    metrics.recordPublicLookup('limited_daily');
    metrics.recordPublicDetection('asked');
    metrics.recordPublicDetection('limited_global');
    metrics.recordPublicParcelRead('ok');
    metrics.recordPublicParcelRead('not_found');
    metrics.recordParcelClaim('kept');
    metrics.recordParcelClaim('unavailable');
    metrics.recordParcelsForgotten('asked', { links: 1, packages: 1 });
    metrics.recordParcelsForgotten('expired', { links: 4, packages: 0 });
    const text = await scraped();
    expect(text).toContain('public_lookup_total{outcome="created"} 2');
    expect(text).toContain('public_lookup_total{outcome="limited_daily"} 1');
    expect(text).toContain('public_detection_total{outcome="asked"} 1');
    expect(text).toContain('public_detection_total{outcome="limited_global"} 1');
    expect(text).toContain('public_parcel_read_total{outcome="ok"} 1');
    expect(text).toContain('public_parcel_read_total{outcome="not_found"} 1');
    expect(text).toContain('parcel_claim_total{outcome="kept"} 1');
    expect(text).toContain('parcel_claim_total{outcome="unavailable"} 1');
    expect(text).toContain('parcel_forgotten_total{kind="link",reason="asked"} 1');
    expect(text).toContain('parcel_forgotten_total{kind="package",reason="asked"} 1');
    expect(text).toContain('parcel_forgotten_total{kind="link",reason="expired"} 4');
    // Nothing was forgotten, so no series appears for it.
    expect(text).not.toContain('parcel_forgotten_total{kind="package",reason="expired"}');
  });

  it('counts delivery emails by how they ended and why, and nothing else', async () => {
    metrics.recordDeliveryEmail('sent', 'none');
    metrics.recordDeliveryEmail('sent', 'none');
    metrics.recordDeliveryEmail('failed', 'smtp');
    metrics.recordDeliveryEmail('skipped', 'no_address');
    metrics.recordDeliveryEmail('skipped', 'account_cap', 3);
    metrics.recordDeliveryEmail('skipped', 'service_cap', 0);
    const text = await scraped();
    expect(text).toContain('delivery_email_total{outcome="sent",reason="none"} 2');
    expect(text).toContain('delivery_email_total{outcome="failed",reason="smtp"} 1');
    expect(text).toContain('delivery_email_total{outcome="skipped",reason="no_address"} 1');
    expect(text).toContain('delivery_email_total{outcome="skipped",reason="account_cap"} 3');
    // Nothing was skipped for everyone's allowance, so no series appears for it.
    expect(text).not.toContain('reason="service_cap"');
    const series = text.split('\n').filter((line) => line.startsWith('delivery_email_total{'));
    expect(series.every((line) => /^delivery_email_total\{outcome="[a-z]+",reason="[a-z_]+"\} \d+$/.test(line))).toBe(true);
  });

  it('counts provider postcode requests by provider and step', async () => {
    metrics.recordProviderInput('ParcelsApp', 'asked');
    metrics.recordProviderInput('ParcelsApp', 'supplied');
    metrics.recordProviderInput('ParcelsApp', 'history');
    const text = await scraped();
    expect(text).toContain('provider_input_total{provider="ParcelsApp",step="asked"} 1');
    expect(text).toContain('provider_input_total{provider="ParcelsApp",step="supplied"} 1');
    expect(text).toContain('provider_input_total{provider="ParcelsApp",step="history"} 1');
  });

  it('serves yesterday\'s lookups and detections per client as gauges', async () => {
    metrics.recordPublicLookupUsage({ buckets: 40, p50: 2, p90: 9, max: 15, detection: { buckets: 31, p50: 3, p90: 12, max: 60 } });
    let text = await metrics.metricsText();
    expect(text).toContain('public_lookup_clients 40');
    expect(text).toContain('public_lookups_per_client{stat="p50"} 2');
    expect(text).toContain('public_lookups_per_client{stat="p90"} 9');
    expect(text).toContain('public_lookups_per_client{stat="max"} 15');
    expect(text).toContain('public_detection_clients 31');
    expect(text).toContain('public_detections_per_client{stat="p90"} 12');
    expect(text).toContain('public_detections_per_client{stat="max"} 60');
    // The next day's summary replaces it.
    metrics.recordPublicLookupUsage({ buckets: 3, p50: 1, p90: 1, max: 1, detection: { buckets: 0, p50: 0, p90: 0, max: 0 } });
    text = await metrics.metricsText();
    expect(text).toContain('public_lookup_clients 3');
    expect(text).toContain('public_lookups_per_client{stat="max"} 1');
    expect(text).toContain('public_detection_clients 0');
  });

  it('only exposes the endpoint with a reasonably long token', () => {
    expect(metrics.metricsToken({})).toBeNull();
    expect(metrics.metricsToken({ METRICS_TOKEN: 'short' })).toBeNull();
    expect(metrics.metricsToken({ METRICS_TOKEN: ' a-token-of-sixteen-chars ' })).toBe('a-token-of-sixteen-chars');
  });
});
