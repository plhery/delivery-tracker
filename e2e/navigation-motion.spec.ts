import { expect, test, type Locator } from '@playwright/test';

test.use({ locale: 'en-US' });

async function aligned(navigation: Locator) {
  await expect.poll(() => navigation.evaluate((nav) => {
    const selected = nav.querySelector('[aria-current="page"]')!.getBoundingClientRect();
    const pill = nav.querySelector('.app__navigation-selection')!.getBoundingClientRect();
    return Math.max(Math.abs(pill.left - selected.left), Math.abs(pill.top - selected.top),
      Math.abs(pill.width - selected.width), Math.abs(pill.height - selected.height));
  })).toBeLessThan(1.5);
}

test('stretches continuously between tabs and follows history, translations, and motion preferences', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sdt.web.experience.v1', 'demo');
    const animate = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (typeof options === 'object' && options.id === 'tab-selection-rubber') {
        animation.pause();
        animation.currentTime = 0;
      }
      return animation;
    };
  });
  await page.goto('/');
  const navigation = page.locator('.app__navigation');
  const pill = navigation.locator('.app__navigation-selection');
  await expect(navigation).toHaveAttribute('data-selection-ready', 'true');
  await aligned(navigation);
  const start = await pill.boundingBox();
  await navigation.getByRole('button', { name: 'Passport', exact: true }).click();
  expect(Math.abs((await pill.boundingBox())!.x - start!.x)).toBeLessThan(1);
  await pill.evaluate((element) => element.getAnimations().forEach((animation) => { animation.currentTime = 100; }));
  const middle = await pill.boundingBox();
  const destination = await navigation.getByRole('button', { name: 'Passport', exact: true }).boundingBox();
  expect(Math.abs(middle!.x - start!.x)).toBeLessThan(1);
  expect(middle!.width).toBeGreaterThan(Math.max(start!.width, destination!.width));
  expect(middle!.x + middle!.width).toBeGreaterThan(destination!.x);
  // Safari composites transforms apart from width, so both edges must move on one clock.
  expect(await pill.evaluate((element) => element.getAnimations()
    .flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes())
    .some((keyframe) => 'transform' in keyframe))).toBe(false);

  await navigation.getByRole('button', { name: 'Friends', exact: true }).click();
  expect(Math.abs((await pill.boundingBox())!.x - middle!.x)).toBeLessThan(1);
  expect(Math.abs((await pill.boundingBox())!.width - middle!.width)).toBeLessThan(1);
  await pill.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));
  await aligned(navigation);
  const beforeBack = await pill.boundingBox();
  await page.goBack();
  await expect(navigation.getByRole('button', { name: 'Passport', exact: true })).toHaveAttribute('aria-current', 'page');
  await pill.evaluate((element) => element.getAnimations().forEach((animation) => { animation.currentTime = 100; }));
  const reverse = await pill.boundingBox();
  expect(reverse!.x).toBeLessThan(beforeBack!.x);
  expect(Math.abs(reverse!.x + reverse!.width - beforeBack!.x - beforeBack!.width)).toBeLessThan(1);
  await pill.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));
  await aligned(navigation);

  await page.locator('.account-trigger').click();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('fr');
  await page.keyboard.press('Escape');
  await expect(page.locator('.settings-sheet')).toHaveCount(0);
  await aligned(navigation);
  await page.setViewportSize({ width: 360, height: 780 });
  await aligned(navigation);

  await navigation.getByRole('button', { name: 'Amis', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await aligned(navigation);
  expect(await pill.evaluate((element) => element.getAnimations().length)).toBe(0);
  await navigation.getByRole('button', { name: 'Livraisons', exact: true }).click();
  await aligned(navigation);
  expect(await pill.evaluate((element) => element.getAnimations().length)).toBe(0);
});
