import { readFileSync, writeFileSync } from 'node:fs';
// Both fresh and cached browser sessions must use the same capture semantics.
for (const tier of [2, 3]) {
  const path = `/app/packages/tiers/src/tiers/${tier}.ts`;
  const source = readFileSync(path, 'utf8');
  const needle = 'const pageCapture = attachPageCapture(page, capture)';
  if (source.split(needle).length !== 2) throw new Error('TRAWL source changed: review the tracking capture integration');
  writeFileSync(path, 'import { attachTrackingCapture } from "../utils/tracking-capture.mjs"\n'
    + source.replace(needle, 'const pageCapture = await attachTrackingCapture(page, url, capture) ?? attachPageCapture(page, capture)'));
}
