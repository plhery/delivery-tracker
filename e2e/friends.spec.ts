import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });
test('Friends shares the navigation, stamp interactions, and reversible privacy controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('sdt.web.experience.v1', 'demo'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Friends', exact: true }).click();
  const mila = page.getByRole('button', { name: /^Mila/ });
  await expect(mila).toBeVisible();
  await expect(page.locator('.friends-cover')).toContainText('9');
  await mila.click();
  const details = page.getByRole('dialog', { name: 'Mila', exact: true });
  await details.getByRole('button', { name: 'First arrival', exact: true }).click();
  await expect(details.getByRole('status')).toContainText('First arrival');
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(mila).toBeFocused();
  await page.goBack();
  await expect(page.locator('.deliveries-page')).toBeVisible();
  await page.goForward();
  await expect(mila).toBeVisible();
  await page.getByRole('button', { name: 'Sharing preferences', exact: true }).click();
  const preferences = page.getByRole('dialog');
  await preferences.getByRole('switch').first().uncheck();
  await expect(preferences.locator('.friend-card')).toContainText('Stats kept private');
  await expect(preferences.getByRole('switch').nth(1)).not.toBeChecked();
  await preferences.getByRole('button', { name: 'Save sharing preferences' }).click();
  await expect(preferences).toHaveCount(0);
  await expect(page.locator('.friends-cover')).toContainText('6');
  await page.getByRole('button', { name: 'Invite a friend', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Sign in');
  await page.keyboard.press('Escape');
  await mila.click();
  await details.getByRole('button', { name: 'Remove friend', exact: true }).click();
  await expect(details).toContainText('Remove Mila');
  await details.getByRole('button', { name: 'Remove friend', exact: true }).click();
  await expect(details).toHaveCount(0);
  await expect(mila).toHaveCount(0);
  await page.getByRole('button', { name: 'Passport', exact: true }).click();
  await page.getByRole('button', { name: 'Friends', exact: true }).click();
  await expect(mila).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Friends and its preview fit a narrow dark screen in each shared locale', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('sdt.web.experience.v1', 'demo'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Friends', exact: true }).click();
  for (const language of ['fr', 'de', 'it', 'en']) {
    await page.locator('.account-trigger').click();
    await page.getByRole('dialog').getByRole('combobox').selectOption(language);
    await page.keyboard.press('Escape');
    await expect(page.locator('.friend-card').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.friends-actions .icon-button').click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('switch').first()).toBeVisible();
    await sheet.getByRole('textbox').fill('A long nickname 12345678');
    await expect(sheet.locator('.friend-card')).toContainText('A long nickname 12345678');
    expect(await sheet.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
  }
});
