import { readFileSync, writeFileSync } from 'node:fs';
// Both fresh and cached browser sessions must use the same capture semantics.
for (const tier of [2, 3]) {
  const path = `/app/packages/tiers/src/tiers/${tier}.ts`;
  const source = readFileSync(path, 'utf8');
  const needle = 'const pageCapture = attachPageCapture(page, capture)';
  if (source.split(needle).length !== 2) throw new Error('TRAWL source changed: review the tracking capture integration');
  const solverGuard = 'if (solveRemaining > 5000)';
  if (source.split(solverGuard).length !== 2) throw new Error('TRAWL solver guard changed');
  const beforeSolve = 'const solveRemaining = maxTimeout - (Date.now() - start)';
  if (source.split(beforeSolve).length !== 2) throw new Error('TRAWL solver integration changed');
  const start = 'const start = Date.now()';
  if (source.split(start).length !== 2) throw new Error('TRAWL tier entry changed');
  const fedex = `if (${tier === 3 ? '!proxyUrl && ' : ''}!screenshot && (!method || method === "GET")
    && !body && !Object.keys(extraHeaders ?? {}).length && australiaPostBrowserRequest(url, capture)) {
    return await runAustraliaPostBrowser({ url, handle, tier: ${tier}, maxTimeout, capture,
      installPolicy: page => installOutboundPolicy(page, validateOutboundUrl) })
  }
  if (${tier === 3 ? '!proxyUrl && ' : ''}!screenshot && (!method || method === "GET")
    && !body && !Object.keys(extraHeaders ?? {}).length && fedexSessionNumber(url, capture)) {
    return await fedexSessions.run({ url, handle, tier: ${tier}, maxTimeout, capture,
      installPolicy: page => installOutboundPolicy(page, validateOutboundUrl) })
  }
  ${start}`;
  writeFileSync(path, 'import { attachTrackingCapture } from "../utils/tracking-capture.mjs"\n'
    + 'import { australiaPostBrowserRequest, runAustraliaPostBrowser } from "../utils/australia-post-browser.mjs"\n'
    + 'import { fedexSessions, fedexSessionNumber } from "../utils/fedex-session.mjs"\n'
    + source.replace(start, fedex)
      .replace(needle, 'const pageCapture = await attachTrackingCapture(page, url, capture) ?? attachPageCapture(page, capture)')
      .replace(solverGuard, 'if (solveRemaining > 5000 && !pageCapture.hasResponse?.() && !pageCapture.hasTrackingRequest?.())')
      .replace(beforeSolve, 'await pageCapture.prepare?.(maxTimeout - (Date.now() - start))\n    ' + beforeSolve));
}

// Retention only helps if the next pool lease returns to the working browser.
// The helper has no dependency on BrowserPool and shares the tier singleton.
const poolPath = '/app/packages/browser/src/pool.ts';
const pool = readFileSync(poolPath, 'utf8');
const pick = '    if (domain) {\n      const sticky = available.find';
if (pool.split(pick).length !== 2) throw new Error('TRAWL browser affinity integration changed');
writeFileSync(poolPath, 'import { preferredFedExEntry } from "../../tiers/src/utils/fedex-session.mjs"\n'
  + pool.replace(pick, '    const retained = preferredFedExEntry(available, domain)\n'
    + '    if (retained) return retained\n' + pick));
