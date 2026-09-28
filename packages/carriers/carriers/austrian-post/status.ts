import type { ClassifiedStatus } from '../../core/status';

// The public website's SendungenApiSchemasExtension distinguishes the summary
// vocabulary from scan codes: a delivered scan can still carry status IZ.
const SUMMARY: Record<string, ClassifiedStatus> = {
  AV: { status: 'pending', stage: 'registered' },
  AN: { status: 'in_transit', stage: 'accepted' },
  IV: { status: 'in_transit', stage: 'in_transit' },
  IZ: { status: 'out_for_delivery', stage: 'out_for_delivery' },
  EB: { status: 'out_for_delivery', stage: 'ready_for_pickup' },
  RE: { status: 'exception', stage: 'returned' },
  ZU: { status: 'delivered', stage: 'delivered' },
};

export function austrianPostSummaryStatus(code: string): ClassifiedStatus | undefined {
  return SUMMARY[code];
}

export function austrianPostEventStatus(code: string, reason: string, text: string): ClassifiedStatus | undefined {
  if (reason === 'ZA' || /\b(?:wurde zugestellt|successfully delivered)\b/i.test(text)) return SUMMARY.ZU;
  if (['BH', 'BN', 'HB', 'NZ', '2055', '2065'].includes(reason)) return { status: 'exception', stage: 'failed_attempt' };
  if (['EAW', 'HO', 'UPB', '2034'].includes(reason)) return SUMMARY.EB;
  if (/\b(?:rücksendung|zurückgesandt|return to sender)\b/i.test(text)) return SUMMARY.RE;
  if (code === 'AZT' || /\b(?:in zustellung|out for delivery)\b/i.test(text)) return SUMMARY.IZ;
  if (code === 'BEI' || code === 'PUG') return SUMMARY.IV;
  // Unmapped scan codes retain their wording for the host's classifier.
  return SUMMARY[code];
}
