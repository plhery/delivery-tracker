import { expect, test, type Page } from '@playwright/test';

test.use({ locale: 'en-US' });
async function demo(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('sdt.web.experience.v1', 'demo');
    // Hold the real animation so geometry and interruptions can be checked
    // independently of how quickly the browser test runner clicks.
    const animate = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = function (frames, options) {
      const result = animate.call(this, frames, options);
      if (typeof options === 'object' && options.id?.startsWith('parcel-')) {
        result.pause();
        result.currentTime = 0;
      }
      return result;
    };
  });
  await page.goto('/');
  await expect(page.locator('.parcel-card--hero')).toBeVisible();
}

test('opens from the tapped mobile card, retaining focus and browser history', async ({ page, isMobile }) => {
  await demo(page);
  const card = page.locator('.parcel-card--hero');
  await card.scrollIntoViewIfNeeded();
  const original = await card.boundingBox();
  await card.click();
  const detail = page.getByRole('dialog', { name: 'Birthday gift 🎁' });
  await expect(detail).toBeVisible();
  const opening = () => detail.evaluate((element) => element.getAnimations().some((animation) => animation.id === 'parcel-card-expand'));
  expect(await opening()).toBe(isMobile);
  if (isMobile) {
    const start = await detail.boundingBox();
    expect(Math.abs(start!.x - original!.x)).toBeLessThan(5);
    expect(Math.abs(start!.y - original!.y)).toBeLessThan(5);
    expect(Math.abs(start!.width - original!.width)).toBeLessThan(5);
    expect(Math.abs(start!.height - original!.height)).toBeLessThan(5);
    await detail.evaluate((element) => element.getAnimations().forEach((animation) => { animation.currentTime = 100; }));
    const middle = await detail.boundingBox();
    expect(middle!.height).toBeGreaterThan(start!.height);
    expect(middle!.height).toBeLessThan(page.viewportSize()!.height);
    await detail.evaluate((element) => element.getAnimations({ subtree: true }).forEach((animation) => animation.finish()));
    await expect.poll(opening).toBe(false);
    await expect(detail).toHaveCSS('transform', 'none');
  }
  await detail.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(detail).toHaveCount(0);
  await expect(card).toBeFocused();
  await expect(page).not.toHaveURL(/parcel=/);
  await page.goForward();
  await expect(detail).toBeVisible();
  expect(await opening()).toBe(false);
  await page.goBack();
  await expect(detail).toHaveCount(0);
  await expect(page.locator('.app')).not.toHaveAttribute('inert');
});

test('handles an interrupted opening and changing motion preferences', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Expansion is reserved for the phone layout.');
  await demo(page);
  const card = page.locator('.parcel-card--hero');
  await card.click();
  const detail = page.getByRole('dialog', { name: 'Birthday gift 🎁' });
  await expect(detail).toHaveClass(/detail--from-card/);
  await detail.evaluate((element) => element.getAnimations().forEach((animation) => { animation.currentTime = 80; }));
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(card).toBeFocused();
  await card.click();
  await expect(detail).toHaveClass(/detail--from-card/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(detail).toHaveCSS('transform', 'none');
  expect(await detail.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  await page.keyboard.press('Escape');
  await card.click();
  await expect(detail).not.toHaveClass(/detail--from-card/);
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
});
