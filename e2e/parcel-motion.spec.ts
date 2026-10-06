import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({ locale: 'en-US' });
/** `held` names the animations to hold: the opening by default, `detail-card-return` for the way back. */
async function demo(page: Page, held = 'parcel-') {
  await page.addInitScript((held) => {
    localStorage.setItem('sdt.web.experience.v1', 'demo');
    // Hold the real animation so geometry and interruptions can be checked
    // independently of how quickly the browser test runner clicks.
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
  await page.goto('/');
  await expect(page.locator('.parcel-card--hero')).toBeVisible();
}

/** The part of the page that shows: its box, cut to the window it is drawn through. */
function shown(detail: Locator) {
  return detail.evaluate((element: HTMLElement) => {
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

/**
 * Scrolls a parcel's page down and tells how far it went. The demo's dates follow the clock, so the journey
 * fills two calendar days at some hours and three at others, and the page has more or less to scroll.
 */
async function scrollDown(detail: Locator) {
  const reached = await detail.evaluate((element) => {
    element.scrollTop = 200;
    return element.scrollTop;
  });
  expect(reached).toBeGreaterThan(0);
  return reached;
}

test('opens from the tapped card, retaining focus and browser history', async ({ page }) => {
  await demo(page);
  const card = page.locator('.parcel-card--hero');
  const parcelName = await card.locator('.parcel-card__label').innerText();
  await card.scrollIntoViewIfNeeded();
  const original = await card.boundingBox();
  await card.click();
  const detail = page.getByRole('dialog', { name: parcelName, exact: true });
  await expect(detail).toBeVisible();
  const opening = () => detail.evaluate((element) => element.getAnimations().some((animation) => animation.id === 'parcel-card-expand'));
  expect(await opening()).toBe(true);
  // The page starts as its card, on a phone and in a wide screen's panel alike: the hero stands in the card's
  // place, and nothing else shows yet.
  const start = await shown(detail);
  expectSameBox(start, original!);
  const hero = (await detail.locator('.detail__hero').boundingBox())!;
  expectSameBox({ ...hero, height: original!.height }, original!);
  await detail.evaluate((element) => element.getAnimations().forEach((animation) => { animation.currentTime = 100; }));
  const middle = await shown(detail);
  expect(middle.height).toBeGreaterThan(start.height);
  expect(middle.height).toBeLessThan(page.viewportSize()!.height);
  expect(middle.opacity).toBe(1);
  // The parcel's dot keeps pulsing and Pip keeps moving: only what can end is finished.
  await detail.evaluate((element) => element.getAnimations({ subtree: true })
    .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
    .forEach((animation) => animation.finish()));
  await expect.poll(opening).toBe(false);
  await expect(detail).toHaveCSS('transform', 'none');
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

test('handles an interrupted opening and changing motion preferences', async ({ page }) => {
  await demo(page);
  const card = page.locator('.parcel-card--hero');
  const parcelName = await card.locator('.parcel-card__label').innerText();
  await card.click();
  const detail = page.getByRole('dialog', { name: parcelName, exact: true });
  await expect(detail).toHaveClass(/detail--from-card/);
  await detail.evaluate((element) => element.getAnimations().forEach((animation) => { animation.currentTime = 80; }));
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(card).toBeFocused();
  await card.click();
  await expect(detail).toHaveClass(/detail--from-card/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(detail).toHaveCSS('transform', 'none');
  // Finished CSS effects can remain attached through animation-fill-mode.
  // Reduced motion must cancel every running or test-paused animation.
  await expect.poll(() => detail.evaluate((element) => element.getAnimations({ subtree: true })
    .filter(animation => animation.playState !== 'finished')
    .map(animation => ({ id: animation.id, state: animation.playState })))).toEqual([]);
  await page.keyboard.press('Escape');
  await card.click();
  await expect(detail).not.toHaveClass(/detail--from-card/);
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
});

test('goes back into its card when closed, from wherever the card is by then', async ({ page }) => {
  await demo(page, 'detail-card-return');
  const card = page.locator('.parcel-card:not(.parcel-card--hero)').first();
  const parcelName = await card.locator('.parcel-card__label').innerText();
  await card.click();
  const detail = page.getByRole('dialog', { name: parcelName, exact: true });
  await expect.poll(() => detail.evaluate((element) => element.getAnimations().length)).toBe(0);
  const open = (await detail.boundingBox())!;
  await detail.getByRole('button', { name: 'Back', exact: true }).click();
  const returning = () => detail.evaluate((element) => element.getAnimations().some((animation) => animation.id === 'detail-card-return'));
  await expect.poll(returning).toBe(true);
  expectSameBox(await shown(detail), open, 1);
  // At the end of its way the page shows through a window the size of the card, and has faded over it.
  await detail.evaluate((element) => element.getAnimations().forEach((animation) => {
    animation.currentTime = Number(animation.effect!.getComputedTiming().endTime) - 1;
  }));
  const landed = await shown(detail);
  expectSameBox(landed, (await card.boundingBox())!, 24);
  expect(landed.opacity).toBeLessThan(0.1);
  await detail.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));
  await expect(detail).toHaveCount(0);
  await expect(card).toBeFocused();
  await expect(page).not.toHaveURL(/parcel=/);
});

test('closes when the page is pulled down from its top, and scrolls when it is not at its top', async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== 'chromium' || !isMobile, 'Real Chromium touch input');
  await demo(page, 'none');
  const client = await page.context().newCDPSession(page);
  const pull = async (distance: number, lift = true) => {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 320 }] });
    for (let step = 1; step <= 10; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 320 + distance * step / 10 }] });
      await page.waitForTimeout(30);
    }
    // The finger rests before it lifts, so a scrolled page is not left gliding on.
    await page.waitForTimeout(150);
    if (lift) await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const card = page.locator('.parcel-card:not(.parcel-card--hero)').first();
  const parcelName = await card.locator('.parcel-card__label').innerText();
  await card.click();
  const detail = page.getByRole('dialog', { name: parcelName, exact: true });
  await expect.poll(() => detail.evaluate((element) => element.getAnimations().length)).toBe(0);

  // A short pull carries the page with the finger, then lets it settle back.
  await pull(70, false);
  const held = await detail.boundingBox();
  expect(held!.y).toBeGreaterThan(50);
  expect(held!.width).toBeLessThan(page.viewportSize()!.width);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(detail).toHaveCSS('transform', 'none');
  await expect(detail).toHaveCSS('clip-path', 'none');

  // A scrolled page keeps scrolling under the finger.
  const scrolled = await scrollDown(detail);
  await pull(120);
  await expect(detail).toHaveCSS('transform', 'none');
  expect(await detail.evaluate((element) => element.scrollTop)).toBeLessThan(scrolled);

  await expect.poll(() => detail.evaluate((element) => {
    element.scrollTop = 0;
    return element.scrollTop;
  })).toBe(0);
  await pull(260);
  await expect(detail).toHaveCount(0);
  await expect(page).not.toHaveURL(/parcel=/);
  await expect(page.locator('.app')).not.toHaveAttribute('inert');
});

test('is carried off sideways too, even when scrolled, and its header holds still past the top', async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== 'chromium' || !isMobile, 'Real Chromium touch input');
  await demo(page, 'none');
  const client = await page.context().newCDPSession(page);
  const drag = async (dx: number, dy: number) => {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 420 }] });
    for (let step = 1; step <= 10; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200 + dx * step / 10, y: 420 + dy * step / 10 }] });
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(150);
  };
  const lift = () => client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const card = page.locator('.parcel-card:not(.parcel-card--hero)').first();
  const parcelName = await card.locator('.parcel-card__label').innerText();
  await card.click();
  const detail = page.getByRole('dialog', { name: parcelName, exact: true });
  await expect.poll(() => detail.evaluate((element) => element.getAnimations().length)).toBe(0);
  // Pulled past its top, the page has no give: the header stays where it is.
  await expect(detail).toHaveCSS('overscroll-behavior-y', 'none');
  const scrolled = await scrollDown(detail);
  // A short way to the side it settles back, still scrolled; further, it closes.
  await drag(-60, 4);
  expect((await detail.boundingBox())!.x).toBeLessThan(-20);
  await lift();
  await expect(detail).toHaveCSS('transform', 'none');
  expect(await detail.evaluate((element) => element.scrollTop)).toBe(scrolled);
  await drag(170, 6);
  await lift();
  await expect(detail).toHaveCount(0);
  await expect(page).not.toHaveURL(/parcel=/);
});
