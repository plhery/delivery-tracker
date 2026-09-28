import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/design/journey');
  await expect(page.locator('main[data-ready="true"]')).toBeVisible();
  await expect(page.locator('[data-scale]')).toBeVisible();
});

test('connects map selections to scans and keeps the whole journey available near arrival', async ({ page }) => {
  const preview = page.getByRole('region', { name: 'Parcel design preview' });
  await expect(preview.locator('[data-scale]')).toHaveAttribute('data-scale', 'world');
  await preview.getByRole('button', { name: 'Near arrival', exact: true }).click();
  await expect(preview.getByRole('button', { name: 'Near arrival', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(preview.locator('[data-scale]')).toHaveAttribute('data-scale', 'local');
  await expect(preview.getByRole('button', { name: /Zürich, Switzerland/ })).toBeVisible();

  await preview.getByRole('group', { name: 'Reported places' }).getByRole('button', { name: /Singapore/ }).click();
  await expect(preview.getByRole('button', { name: 'Whole journey', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(preview.locator('[aria-live="polite"]')).toContainText('Processed at the export hub');
  await expect(preview.getByRole('button', { name: /Singapore, Singapore/ })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /03 Journey atlas/ }).click();
  await preview.getByRole('list', { name: 'Journey itinerary' }).getByRole('button', { name: /Frankfurt/ }).click();
  await expect(preview.locator('[aria-live="polite"]')).toContainText('Arrived at the transit hub');
  await expect(preview.getByRole('button', { name: /Frankfurt, Germany/ })).toHaveAttribute('aria-pressed', 'true');
});

test('shows one known stop without suggesting a current position and recovers after an empty journey', async ({ page }) => {
  const preview = page.getByRole('region', { name: 'Parcel design preview' });
  await page.getByRole('radio', { name: 'One known stop' }).check();
  await expect(preview.getByText('Last known location', { exact: true })).toBeVisible();
  await expect(preview.locator('[data-current="true"]')).toHaveCount(0);
  await expect(preview.getByText('The latest update has no location.', { exact: false })).toBeVisible();

  await page.getByRole('radio', { name: 'No locations yet' }).check();
  await expect(preview.getByText('The journey starts with a scan.')).toBeVisible();
  await expect(preview.locator('[data-scale]')).toHaveCount(0);

  await page.getByRole('radio', { name: 'Close to home' }).check();
  await expect(preview.locator('[data-scale]')).toHaveAttribute('data-scale', 'local');
  await preview.getByRole('button', { name: /Zürich, Switzerland/ }).click();
  await expect(preview.locator('[aria-live="polite"]')).toContainText('With the local delivery round');
  const dimensions = await preview.locator('[data-scale]').evaluate(element => {
    const svg = element.querySelector('svg')!;
    return { rendered: element.clientWidth, projected: svg.viewBox.baseVal.width };
  });
  expect(Math.abs(dimensions.rendered - dimensions.projected)).toBeLessThan(2);
});

test('keeps every direction readable at phone sizes, with accessible controls and a dark preview', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Phone', exact: true }).click();
  await page.getByRole('button', { name: 'Dark preview', exact: true }).click();
  const article = page.locator('article');
  await expect(article).toHaveAttribute('data-theme', 'dark');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const direction of [/01 Route postcard/, /02 Map first/, /03 Journey atlas/]) {
      await page.getByRole('button', { name: direction }).click();
      for (const scenario of ['Across the world', 'Across the border', 'Close to home', 'One known stop', 'No locations yet']) {
        await page.getByRole('radio', { name: scenario, exact: true }).check();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await article.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
    }
  }
  await page.getByRole('radio', { name: 'Across the world', exact: true }).check();
  await page.getByRole('button', { name: /01 Route postcard/ }).click();
  const controls = page.getByRole('region', { name: 'Parcel design preview' }).getByRole('group', { name: 'Reported places' });
  for (const button of await controls.getByRole('button').all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(errors).toEqual([]);
});
