import { carrierErrorKind } from '@carriers/core/errors';

/** Stable public copy codes. Full diagnostics remain in the tracking audit. */
export function trackingFailureCode(error: unknown): string | null {
  const kind = carrierErrorKind(error);
  return kind ? `carrier:${kind}` : null;
}

/** Do not blame one provider when several failed for different reasons. */
export function deferredTrackingFailure(
  failures: Record<string, { user_error?: string; kind: string }>,
  configuredCarrier: string,
): string | null {
  if (failures[configuredCarrier]?.user_error === 'carrier:input_required') return 'carrier:input_required';
  const codes = Object.values(failures).map(failure => failure.user_error
    ?? ({ rate_limited: 'carrier:rate_limited', verification: 'carrier:challenge', not_found: 'carrier:not_found' } as Record<string, string>)[failure.kind]);
  return codes.length && codes[0] && codes.every(code => code === codes[0]) ? codes[0] : null;
}
