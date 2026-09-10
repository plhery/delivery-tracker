import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('sdt.web.experience.v1', 'demo'));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Add a parcel', exact: true }).click();
});

test('opens tracking first, keeps naming optional, and returns focus on close', async ({ page, isMobile }) => {
  const dialog = page.getByRole('dialog', { name: 'Add a parcel' });
  const tracking = dialog.getByLabel('Tracking number or link');
  const name = dialog.getByLabel(/^Name/);
  await expect(tracking).toBeFocused();
  expect((await tracking.boundingBox())!.y).toBeLessThan((await name.boundingBox())!.y);
  const bounds = (await dialog.boundingBox())!;
  if (isMobile) {
    expect(bounds.y).toBeCloseTo(0, 0);
    expect(bounds.height).toBeCloseTo(page.viewportSize()!.height, 0);
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeHidden();
  } else {
    expect(bounds.width).toBeLessThanOrEqual(440);
    expect(bounds.x).toBeGreaterThan(0);
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  }
  await tracking.fill('1Z999AA10123456784');
  await expect(dialog.getByText('UPS', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add parcel', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add a parcel', exact: true })).toBeFocused();
});

test('keeps Add above a reduced visual viewport while required fields scroll', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The full-screen keyboard layout is mobile only');
  const dialog = page.getByRole('dialog', { name: 'Add a parcel' });
  await dialog.getByLabel('Tracking number or link').fill('123456');
  await dialog.getByRole('combobox').selectOption('dpd');
  await dialog.getByLabel(/Delivery postcode/).fill('');

  // Desktop browser runners do not open an OS keyboard. Model the visual
  // viewport resize and pan that Safari/Chrome deliver when it opens.
  await page.evaluate(() => {
    Object.defineProperty(visualViewport!, 'height', { configurable: true, value: 380 });
    Object.defineProperty(visualViewport!, 'offsetTop', { configurable: true, value: 35 });
    visualViewport!.dispatchEvent(new Event('resize'));
    visualViewport!.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(async () => (await dialog.boundingBox())!.height).toBeCloseTo(380, 0);
  const add = dialog.getByRole('button', { name: 'Add parcel', exact: true });
  const addBounds = (await add.boundingBox())!;
  expect(addBounds.y + addBounds.height).toBeLessThanOrEqual(415);
  expect(addBounds.y).toBeGreaterThan(35);
  await expect(add).toBeDisabled();
  await dialog.getByLabel(/Delivery postcode/).fill('8004');
  await dialog.getByLabel(/^Name/).scrollIntoViewIfNeeded();
  await dialog.getByLabel(/^Name/).click();
  await dialog.getByLabel(/^Name/).fill('Coffee beans');
  const nameBounds = (await dialog.getByLabel(/^Name/).boundingBox())!;
  expect(nameBounds.y + nameBounds.height).toBeLessThanOrEqual(addBounds.y + 1);
  await expect(add).toBeEnabled();
  await add.click();
  await expect(dialog).toBeHidden();
});

test('explains Amazon France account tracking and blocks addition', async ({ page }, testInfo) => {
  const dialog = page.getByRole('dialog', { name: 'Add a parcel' });
  await dialog.getByLabel('Tracking number or link').fill('FR3000000001');
  await expect(dialog.getByText('Amazon France', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Amazon France keeps delivery updates in your Amazon account/)).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open my Amazon orders' }))
    .toHaveAttribute('href', 'https://www.amazon.fr/gp/your-account/order-history');
  await expect(dialog.getByRole('button', { name: 'Add parcel', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('amazon-france.png') });
});
