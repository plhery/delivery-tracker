import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import fr from '../shared/locales/fr.json' with { type: 'json' };
import de from '../shared/locales/de.json' with { type: 'json' };

// Shut down a dedicated origin to exercise real network loss. WebKit's emulated
// offline mode can abort navigations before its service worker handles them.
async function dedicatedOrigin() {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('No test port available');
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ['.next/standalone/server.js'], {
    env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: String(address.port) },
    stdio: 'ignore',
  });
  const exited = once(child, 'exit');
  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: async () => { child.kill('SIGTERM'); await exited; },
  };
}

test('serves a translated, interactive fallback when the server becomes unreachable', async ({ page }) => {
  test.skip(!process.env.CI && !process.env.PLAYWRIGHT_PRODUCTION, 'Requires the production service worker.');
  const origin = await dedicatedOrigin();
  try {
    await expect.poll(async () => fetch(origin.url).then((response) => response.status).catch(() => 0)).toBe(200);
    const securityErrors: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy|violates.*directive/i.test(message.text())) securityErrors.push(message.text());
    });
    page.on('pageerror', (error) => securityErrors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('sdt.web.experience.v1', 'demo'));
    await page.goto(origin.url);
    await expect(page.getByText('Coffee beans ☕', { exact: true })).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.goto(`${origin.url}/~offline`);
    await page.getByRole('combobox', { name: 'Language' }).selectOption('fr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(fr['offline.title']);
    await page.goto(origin.url);
    await expect(page.getByText('Coffee beans ☕', { exact: true })).toBeVisible();
    await origin.stop();
    await page.goto(`${origin.url}/uncached-offline-navigation`);
    await expect(page).toHaveURL(`${origin.url}/~offline`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(fr['offline.title']);
    await page.getByRole('combobox').selectOption('de');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(de['offline.title']);
    expect(securityErrors).toEqual([]);
  } finally {
    await origin.stop();
  }
});
