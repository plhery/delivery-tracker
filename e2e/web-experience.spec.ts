import { expect, test, type Page } from '@playwright/test';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page)!.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.get(page)!.push(message.text()); });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });
async function demo(page: Page) {
  await page.addInitScript(() => localStorage.setItem('sdt.web.experience.v1', 'demo'));
  await page.goto('/');
  await expect(page.getByText('Coffee beans ☕', { exact: true })).toBeVisible();
}
async function settings(page: Page) {
  await page.locator('.account-trigger').click();
  return page.getByRole('dialog', { name: 'Account', exact: true });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test('opens the looping package into sign-in, then leaves demo without a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Good things are on their way.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /try the demo/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tap to open your parcel' })).toBeEnabled();
  const illustration = page.locator('.arrival__parcel');
  await illustration.evaluate((element) => element.setAttribute('data-kept', 'yes'));
  expect(await page.locator('.parcel-illustration__body').evaluate((element) => getComputedStyle(element).animationIterationCount)).toBe('infinite');
  await page.getByRole('button', { name: 'Tap to open your parcel' }).click();
  await expect(page.getByRole('heading', { name: 'Your deliveries, together.' })).toBeVisible();
  await expect(illustration).toHaveAttribute('data-kept', 'yes');
  await expect(page.getByRole('heading', { name: 'Your deliveries, together.' })).toBeFocused();
  await page.getByRole('button', { name: 'or try the demo' }).click();
  await expect(page.getByRole('heading', { name: 'Deliveries', exact: true })).toBeAttached();
  await page.getByRole('button', { name: 'Exit demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your deliveries, together.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your deliveries, together.' })).toBeVisible();
  await expect(page.locator('.demo-banner')).toHaveCount(0);
});

test('keeps demo exit available from parcel details and account', async ({ page }) => {
  await demo(page);
  await page.getByText('Coffee beans ☕', { exact: true }).click();
  await page.getByRole('dialog', { name: 'Coffee beans ☕' }).getByRole('button', { name: 'Exit demo' }).click();
  await expect(page.getByRole('heading', { name: 'Your deliveries, together.' })).toBeVisible();
  await expect(page).not.toHaveURL(/parcel=/);
  await page.getByRole('button', { name: 'or try the demo' }).click();
  const account = await settings(page);
  await account.getByRole('button', { name: 'Exit demo' }).click();
  await expect(page.locator('.arrival--sign-in')).toBeVisible();
  await expect(page.locator('[inert]')).toHaveCount(0);
});

test('updates an open settings sheet from dark to system and follows OS changes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await demo(page);
  const sheet = await settings(page);
  await sheet.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(sheet).toHaveCSS('background-color', 'rgb(21, 25, 21)');
  await sheet.getByRole('button', { name: 'System', exact: true }).click();
  await expect(sheet).toHaveCSS('background-color', 'rgb(244, 245, 241)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(sheet).toHaveCSS('background-color', 'rgb(21, 25, 21)');
  await sheet.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(sheet).toHaveCSS('background-color', 'rgb(244, 245, 241)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
});

test('keeps language and account consistent across deliveries, Passport, and parcel forms', async ({ page }) => {
  await demo(page);
  const account = await settings(page);
  await account.getByRole('combobox', { name: 'Language' }).selectOption('fr');
  await page.keyboard.press('Escape');
  await expect(account).toBeHidden();
  await page.getByRole('button', { name: 'Passeport', exact: true }).click();
  await expect(page.locator('.passport-cover')).toContainText('Livrés');
  await expect(page.locator('.parcel-card:visible')).toHaveCount(0);
  await page.locator('.account-trigger').click();
  await expect(page.getByRole('dialog')).toContainText('Apparence');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ajouter un colis', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Ajouter un colis' });
  await expect(sheet.getByLabel(/^Titre/)).toBeFocused();
  await sheet.locator('#add-parcel-tracking').fill('993411111122222222');
  await expect(sheet.getByText('Swiss Post', { exact: true })).toBeVisible();
  await expect(sheet.getByText(/Nous consulterons automatiquement/)).toHaveCount(0);
  await noOverflow(page);
});

test('shows real Passport rewards and opens stamp explanations accessibly', async ({ page }) => {
  await demo(page);
  await page.getByRole('button', { name: 'Passport', exact: true }).click();
  await expect(page.locator('.passport-cover__count')).toHaveText('1');
  await expect(page.locator('.passport-note')).toHaveText('From 1 timed journey');
  await expect(page.locator('.country-row')).toHaveCount(3);
  const stamp = page.getByRole('button', { name: 'First arrival Unlocked', exact: true });
  await stamp.click();
  const sheet = page.getByRole('dialog', { name: 'First arrival' });
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(sheet.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(stamp).toBeFocused();
  await page.goBack();
  await expect(page.locator('.deliveries-page')).toBeVisible();
});

test('respects reduced motion while retaining every action', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Tap to open your parcel' }).click();
  await expect(page.getByRole('heading', { name: 'Your deliveries, together.' })).toBeVisible();
  expect(await page.locator('.parcel-illustration__body').evaluate((element) => getComputedStyle(element).animationIterationCount)).not.toBe('infinite');
  await page.getByRole('button', { name: 'or try the demo' }).click();
  await page.getByRole('button', { name: 'Add a parcel', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('keeps every screen within a narrow viewport in dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await demo(page);
  await noOverflow(page);
  await page.getByRole('button', { name: 'Passport', exact: true }).click();
  await noOverflow(page);
  await page.getByRole('button', { name: 'Add a parcel', exact: true }).click();
  await page.getByLabel('Tracking number or link').fill('hello there');
  await expect(page.getByRole('button', { name: 'Add parcel', exact: true })).toBeDisabled();
  await noOverflow(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Deliveries', exact: true }).click();
  await page.getByText('Coffee beans ☕', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Coffee beans ☕' })).toBeVisible();
  await noOverflow(page);
});

test('scrolls from a card, reveals archive smoothly, and supports reversing the swipe', async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile || browserName !== 'chromium', 'Uses real Chromium touch input on the mobile layout.');
  await demo(page);
  const touch = await page.context().newCDPSession(page);
  async function swipe(x: number, y: number, dx: number, dy: number) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 12; step++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 12, y: y + dy * step / 12 }] });
      await page.waitForTimeout(16);
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const hero = page.locator('.parcel-card--hero');
  const box = await hero.boundingBox();
  await swipe(box!.x + 100, box!.y + 180, 6, -150);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(50);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(300);
  const x = box!.x + 230; const y = box!.y + 130;
  await swipe(x, y, -70, 3);
  await expect(hero).toHaveCSS('transform', 'matrix(1, 0, 0, 1, -88, 0)');
  const archive = page.getByRole('button', { name: 'Archive Birthday gift 🎁', exact: true });
  await expect(archive).toBeVisible();
  await swipe(x - 88, y, 70, 2);
  await expect(hero).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await expect(archive).toBeHidden();
  await swipe(x, y, -220, 1);
  await expect(page.getByRole('status')).toContainText('Birthday gift 🎁 archived');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Birthday gift 🎁', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
