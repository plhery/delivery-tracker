import { expect, test, type Page } from '@playwright/test';
import { fits, track } from './peek';

// The demo build keeps lookups in the browser and sends an answer nowhere; every number here is fictional.
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page)!.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.get(page)!.push(message.text()); });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

const status = (page: Page) => page.getByRole('heading', { level: 1 });

test('asks where the history ends whether the page is right, takes a reason and a note, and stands again on the next visit', async ({ page }) => {
  const sent: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/feedback')) sent.push(request.url()); });
  await track(page, '1ZDEMO202600000092');
  await expect(status(page)).toHaveText('In transit');
  const bubble = page.locator('.peekfb-bubble');
  await expect(bubble.getByText('Did I get this one right?')).toBeVisible();
  await bubble.getByRole('button', { name: 'Not quite' }).click();
  await expect(bubble.getByText('What’s off?')).toBeVisible();
  await bubble.getByRole('button', { name: 'Missing steps' }).click();
  await expect(bubble.getByRole('status')).toHaveText('Thanks! I’ll look into it.');

  await bubble.getByRole('button', { name: 'Add a note' }).click();
  const sheet = page.getByRole('dialog', { name: 'What’s off?' });
  await expect(sheet.getByRole('button', { name: 'Missing steps' })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByLabel('Anything to add? Optional').fill('It left the depot yesterday.');
  await sheet.getByRole('button', { name: 'Send' }).click();
  await expect(sheet).toHaveCount(0);
  // The sheet hands the focus back to the question, so the page stays where its reader was.
  await expect(bubble).toBeFocused();
  await expect(bubble).toBeInViewport();
  await expect(bubble.getByRole('button')).toHaveCount(0);

  // Something may happen that its reader tells only later: the question stands on every visit.
  await page.reload();
  await expect(status(page)).toHaveText('In transit');
  await expect(page.locator('.peekfb-bubble').getByText('Did I get this one right?')).toBeVisible();
  // The demo's answer goes nowhere.
  expect(sent).toEqual([]);
});

test('asks once on the way back from the carrier’s own site, and not about the sample parcel', async ({ page }) => {
  await track(page, '1ZDEMO202600000092');
  await expect(status(page)).toHaveText('In transit');
  // A page just looked up is still saying that the parcel has its own link, and asks nothing over that.
  await page.reload();
  await expect(page.locator('.peekfb-bubble')).toBeVisible();
  // The carrier's page opens in another tab: the test stands in for the tab being left and come back to.
  const leaveAndReturn = async () => {
    await page.evaluate(() => {
      const state = window as unknown as { away?: boolean };
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => state.away === true });
      const link = document.querySelector<HTMLAnchorElement>('.peekp-number__link')!;
      link.addEventListener('click', (event) => event.preventDefault(), { once: true });
      link.click();
      state.away = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(1_700);
    await page.evaluate(() => {
      (window as unknown as { away?: boolean }).away = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });
  };
  await leaveAndReturn();
  const toast = page.locator('.peekp-toast', { hasText: 'Does UPS say the same?' });
  await expect(toast).toBeVisible();
  expect(await fits(page)).toBe(true);
  await toast.getByRole('button', { name: 'Yes' }).click();
  await expect(page.getByText('Thanks, good to know.')).toBeVisible();
  await expect(page.locator('.peekfb-bubble').getByRole('status')).toHaveText('Good to know, thanks!');
  await leaveAndReturn();
  await expect(page.getByText('Does UPS say the same?')).toHaveCount(0);

  await page.goto('/sample');
  await expect(status(page)).toBeVisible();
  await expect(page.locator('.peekp-fresh')).toBeVisible();
  await expect(page.locator('.peekfb-bubble')).toHaveCount(0);
});

test('fits a phone at 320 px, in German and in the dark', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('deliveryTrackerLocale', 'de'));
  await track(page, '1ZDEMO202600000092', { field: 'Sendungsnummer oder Link', track: 'Verfolgen' });
  const bubble = page.locator('.peekfb-bubble');
  await expect(bubble.getByText('Liege ich hier richtig?')).toBeVisible();
  expect(await fits(page)).toBe(true);
  await bubble.getByRole('button', { name: 'Nicht ganz' }).click();
  await expect(bubble.getByRole('button')).toHaveCount(6);
  expect(await fits(page)).toBe(true);
  await bubble.getByRole('button', { name: 'Falscher Paketdienst' }).click();
  await bubble.getByRole('button', { name: 'Notiz hinzufügen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Was stimmt nicht?' });
  await expect(sheet.getByRole('button', { name: 'Senden' })).toBeVisible();
  expect(await fits(page)).toBe(true);
  expect(await sheet.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
