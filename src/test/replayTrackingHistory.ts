import type { CarrierResult } from 'universal-parcel-scraper';
import records from '../server/fixtures/historyResults.json';
export type AuditedScan = { provider: string; description: string; code?: string; expected: string };

/** Parser/classifier tests live in the scraper; the app replays their result contracts. */
export async function replayAuditedScan(scan: AuditedScan, translatedDescription?: string): Promise<CarrierResult> {
  const key = JSON.stringify([scan.provider, scan.code ?? '', translatedDescription ?? scan.description]);
  const result = (records as Record<string, unknown>)[key];
  if (!result) throw new Error(`Missing synthetic carrier result: ${key}`);
  return structuredClone(result) as CarrierResult;
}
