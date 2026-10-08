import { expect, test, type Locator, type Page } from '@playwright/test';
import { track } from './peek';

test.use({ locale: 'en-US' });

/** Holds the animations named, so that their geometry can be read whatever the runner's pace. */
async function hold(page: Page, held: string) {
  await page.addInitScript((held) => {
    const animate = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = function (frames, options) {
      const result = animate.call(this, frames, options);
      if (typeof options === 'object' && options.id?.startsWith(held)) {
        result.pause();
        result.currentTime = 0;
      }
      return result;
    };
  }, held);
}

/** The part of the page that shows: its box, cut to the window it is drawn through. */
function shown(over: Locator) {
  return over.evaluate((element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    const scale = bounds.width / element.offsetWidth;
    const style = getComputedStyle(element);
    const cuts = /^inset\(([^)]*?)(?: round [^)]*)?\)$/.exec(style.clipPath)?.[1].split(' ').map(Number.parseFloat) ?? [0];
    const [top, right = top, bottom = top, left = right] = cuts;
    return {
      x: bounds.left + left * scale, y: bounds.top + top * scale,
      width: bounds.width - (left + right) * scale, height: bounds.height - (top + bottom) * scale,
      opacity: Number(style.opacity),
    };
  });
}

function expectSameBox(actual: { x: number; y: number; width: number; height: number }, expected: { x: number; y: number; width: number; height: number }, tolerance = 5) {
  for (const side of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(actual[side] - expected[side]), side).toBeLessThan(tolerance);
}

const finish = (over: Locator) => over.evaluate((element) => element.getAnimations({ subtree: true })
  .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
  .forEach((animation) => animation.finish()));

/**
 * A parcel looked up at the door, and the door again with the parcel's card on it. The card is found by what marks
 * it, so that it can be measured while the page lies over the door and hides it from every reader.
 */
async function doorWithParcel(page: Page) {
  await track(page, 'DEMOCHOC20260001');
  // Once the carrier has answered the parcel leads the list, on another card than a parcel still waiting.
  await expect(page.getByRole('heading', { level: 1, name: 'Out for delivery' })).toBeVisible();
  await page.goBack();
  const card = page.locator('.door-device [data-parcel-link]');
  await expect(card).toContainText('Out for delivery');
  // A click first scrolls a card lying under the page's scroll padding into view: it is measured where the click finds it.
  await card.scrollIntoViewIfNeeded();
  return card;
}

test('a parcel of this device opens out of its card over the door, and closes back into it', async ({ page }) => {
  await hold(page, 'parcel-');
  const card = await doorWithParcel(page);
  const title = await page.title();
  const original = (await card.boundingBox())!;
  await card.click();
  const over = page.getByRole('dialog', { name: 'Parcel details' });
  await expect(over).toBeVisible();
  await expect(page).toHaveURL(/\/p\//);
  // The door waits underneath, out of reach.
  await expect(page.locator('.door')).toHaveAttribute('inert');
  expectSameBox(await shown(over), original);
  await finish(over);
  await expect(over).toHaveCSS('transform', 'none');
  await expect(over.getByRole('heading', { level: 1, name: 'Out for delivery' })).toBeVisible();
  expect(await page.title()).not.toBe(title);

  // Its name leads home: the page closes, and the door is as it was left.
  await over.getByRole('button', { name: 'Peek', exact: true }).click();
  await expect(over).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/p\//);
  await expect(page.locator('.door')).not.toHaveAttribute('inert');
  await expect(card).toBeFocused();
  await expect.poll(() => page.title()).toBe(title);
  // Forward opens it again, without the card's flight; Escape closes it.
  await page.goForward();
  await expect(over).toBeVisible();
  expect(await over.evaluate((element) => element.getAnimations().length)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(over).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
});

test('the page folds back onto the card it came from', async ({ page }) => {
  await hold(page, 'detail-card-return');
  const card = await doorWithParcel(page);
  await card.click();
  const over = page.getByRole('dialog', { name: 'Parcel details' });
  await expect.poll(() => over.evaluate((element) => element.getAnimations().length)).toBe(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => over.evaluate((element) => element.getAnimations().some((animation) => animation.id === 'detail-card-return'))).toBe(true);
  await over.evaluate((element) => element.getAnimations().forEach((animation) => {
    animation.currentTime = Number(animation.effect!.getComputedTiming().endTime) - 1;
  }));
  const landed = await shown(over);
  expectSameBox(landed, (await card.boundingBox())!, 24);
  expect(landed.opacity).toBeLessThan(0.1);
  await over.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));
  await expect(over).toHaveCount(0);
});

test('pulling the page down closes it, and the door has not moved', async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== 'chromium' || !isMobile, 'Real Chromium touch input');
  const card = await doorWithParcel(page);
  const client = await page.context().newCDPSession(page);
  const before = await card.boundingBox();
  await card.click();
  const over = page.getByRole('dialog', { name: 'Parcel details' });
  await expect.poll(() => over.evaluate((element) => element.getAnimations().length)).toBe(0);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 320 }] });
  for (let step = 1; step <= 10; step++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 320 + 26 * step }] });
    await page.waitForTimeout(30);
  }
  expect((await over.boundingBox())!.y).toBeGreaterThan(100);
  await page.waitForTimeout(150);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(over).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/p\//);
  expect(await card.boundingBox()).toEqual(before);
});

test('Pip’s sample lies over the door too, and closes back to him', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const pip = page.getByRole('link', { name: 'Open a sample parcel' });
  await pip.click();
  const over = page.getByRole('dialog', { name: 'Parcel details' });
  await expect(over.getByText('Sample parcel')).toBeVisible();
  await expect(page).toHaveURL(/\/sample$/);
  await page.keyboard.press('Escape');
  await expect(over).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/sample$/);
  // The door started over under the page: Pip is closed again, and opens the sample once more.
  await expect(pip).toBeVisible();
  await expect(page.locator('.door-pip')).not.toHaveClass(/door-pip--opening/);
});
