// Runs in the production image with its user, traced dependencies and browser.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { withLocalBrowser } from 'universal-parcel-scraper/node';
import sharp from 'sharp';

await import('onnxruntime-web');
await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } }).png().toBuffer();
assert.ok(process.env.TRACKING_CHROMIUM_PATH, 'The tracking browser must be configured');

for (let round = 0; round < 3; round += 1) {
  await withLocalBrowser({ provider: 'Tracking runtime check', executablePath: process.env.TRACKING_CHROMIUM_PATH,
    timeoutMs: 15_000 }, async ({ browser }) => {
    const page = await browser.newPage();
    await page.setContent('<title>tracking browser ready</title>');
    assert.equal(await page.title(), 'tracking browser ready');
  });
}

function zombies() {
  return readdirSync('/proc').filter(pid => /^\d+$/.test(pid)).filter(pid => {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z');
    } catch { return false; }
  });
}
let remaining = zombies();
for (let attempt = 0; remaining.length > 0 && attempt < 50; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 100));
  remaining = zombies();
}
assert.equal(remaining.length, 0, 'Browser lookups must leave no zombie processes');
console.log('Tracking transports load, Chromium renders and browser processes are reaped.');
