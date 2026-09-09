import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sdt.web.experience.v1', 'demo'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Friends', exact: true }).click();
});

test('The compact circle opens Passport stamps and keeps bubble dismissal inside its sheet', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const mila = page.getByRole('button', { name: /^Mila/ });
  await expect(mila).toBeVisible();
  await expect(page.locator('.friends-own-row')).toContainText('Your sharing');
  await expect(page.locator('.friends-cover')).toHaveCount(0);
  await page.screenshot({ path: `/tmp/friends-circle-${test.info().project.name}.png` });
  await mila.click();
  const details = page.locator('.friends-sheet');
  await expect(details.locator('.friend-postcard')).toContainText('Mila');
  await expect(details.locator('.passport-seal--locked').first()).toBeVisible();
  await details.getByRole('button', { name: 'First arrival', exact: true }).click();
  await expect(details.locator('.passport-bubble:popover-open')).toContainText('First arrival');
  await page.keyboard.press('Escape');
  await expect(details.locator('.passport-bubble:popover-open')).toHaveCount(0);
  await expect(details).toBeVisible();
  await details.getByRole('button', { name: 'All stamps' }).click();
  await expect(details.locator('.stamp-card')).toHaveCount(12);
  await page.screenshot({ path: `/tmp/friends-passport-${test.info().project.name}.png` });
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(mila).toBeFocused();
  expect(errors).toEqual([]);
});

test('Sharing controls stay in place and preserve saved privacy preferences', async ({ page }) => {
  await page.getByRole('button', { name: 'Sharing preferences', exact: true }).click();
  const sheet = page.locator('.friends-sheet');
  const arrivals = sheet.getByRole('switch', { name: 'Arrivals this week', exact: true });
  await arrivals.check();
  const before = await arrivals.boundingBox();
  await arrivals.click();
  const after = await arrivals.boundingBox();
  expect(after!.y).toBeCloseTo(before!.y, 0);
  await expect(arrivals).not.toBeChecked();
  await expect(sheet.getByRole('button', { name: 'Turn off Friends' })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Sharing preferences', exact: true }).click();
  await expect(arrivals).not.toBeChecked();
});

test('Circle and sharing fit narrow screens in all languages', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  for (const language of ['fr', 'de', 'it', 'en']) {
    await page.locator('.account-trigger').click();
    await page.getByRole('dialog').getByRole('combobox').selectOption(language);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.friends-own-row').click();
    const sheet = page.locator('.friends-sheet');
    await sheet.getByRole('textbox').fill('A long nickname 12345678');
    await expect(sheet.locator('.friend-sharing-preview')).toContainText('A long nickname 12345678');
    expect(await sheet.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/friends-sharing-${language}-${test.info().project.name}.png` });
    await page.keyboard.press('Escape');
  }
});

test('Demo invitations offer sign-in without creating a fake link', async ({ page }) => {
  await page.getByRole('button', { name: 'Invite a friend', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in instead', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tap to open your parcel' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('sdt.web.experience.v1'))).toBe('welcome');
});
