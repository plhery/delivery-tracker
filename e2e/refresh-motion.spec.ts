import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({ locale: 'en-US' });

async function demo(page: Page, holdAnimation = false) {
  await page.addInitScript((hold) => {
    localStorage.setItem('sdt.web.experience.v1', 'demo');
    if (!hold) return;
    const animate = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (typeof options === 'object' && options.id === 'refresh-turn') {
        animation.pause();
        animation.currentTime = 0;
      }
      return animation;
    };
  }, holdAnimation);
  await page.goto('/');
  await expect(page.locator('.parcel-card--hero')).toBeVisible();
}

async function finishTurn(button: Locator) {
  const glyph = button.locator('.refresh-glyph');
  await expect.poll(() => glyph.evaluate((element) => element.getAnimations()[0]?.effect?.getTiming().iterations)).toBe(1);
  await glyph.evaluate((element) => { element.getAnimations()[0].currentTime = 450; });
  const halfway = await glyph.evaluate((element) => getComputedStyle(element).transform);
  expect(halfway).not.toBe('none');
  await expect(button).toBeDisabled();
  await glyph.evaluate((element) => { element.getAnimations()[0].currentTime = 899; });
  const before = await glyph.evaluate((element) => getComputedStyle(element).transform);
  // The last frame has already returned to the resting angle before cleanup.
  expect(Number(before.split(',')[0].replace('matrix(', ''))).toBeCloseTo(1, 3);
  await glyph.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));
  await expect(button).toBeEnabled();
  await expect(glyph).toHaveCSS('transform', 'none');
}

test('finishes fast refreshes with a complete eased turn, on the list and parcel detail', async ({ page }) => {
  await demo(page, true);
  const refresh = page.locator('.delivery-overview button').last();
  await refresh.click();
  await finishTurn(refresh);
  await page.locator('.parcel-card').filter({ hasText: 'Coffee beans' }).click();
  const detailRefresh = page.locator('.detail__refresh');
  await detailRefresh.click();
  await finishTurn(detailRefresh);
});

async function pull(surface: Locator, distance: number, end = true) {
  await surface.evaluate((element, { distance, end }) => {
    const target = element.querySelector('.parcel-card')!;
    // WebKit exposes Touch but does not allow constructing it. The real-input
    // Chromium test below separately exercises browser gesture arbitration.
    const dispatch = (type: string, y?: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: y === undefined ? [] : [{ identifier: 1, target, clientX: 160, clientY: y }] });
      target.dispatchEvent(event);
    };
    dispatch('touchstart', 200);
    dispatch('touchmove', 200 + distance);
    if (end) dispatch('touchend');
  }, { distance, end });
}

test('resists the pull, arms on distance, and settles after a completion check', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch interaction');
  await demo(page);
  const surface = page.locator('.pull-refresh');
  await pull(surface, 190, false);
  await expect(surface).toHaveAttribute('data-armed', 'true');
  const displacement = await surface.evaluate((element) => Number.parseFloat((element as HTMLElement).style.getPropertyValue('--pull-distance')));
  expect(displacement).toBeGreaterThan(72);
  expect(displacement).toBeLessThan(100);
  await expect(surface.locator('.pull-refresh__label')).toHaveText('Release to refresh');
  await surface.dispatchEvent('touchend', { touches: [] });
  await expect(surface).toHaveAttribute('data-phase', 'refreshing');
  await expect(surface).toHaveAttribute('data-phase', 'success');
  await expect(surface.locator('.pull-refresh__label')).toHaveText('Tracking updated');
  await expect(surface).toHaveAttribute('data-phase', 'idle');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(surface.locator('.pull-refresh__content')).toHaveCSS('transform', 'none');
  await pull(surface, 60);
  await expect(surface).toHaveAttribute('data-phase', 'settling');
  await expect(surface).toHaveAttribute('data-phase', 'idle');
});

test('supports reduced motion and a motion preference changed mid-refresh', async ({ page, isMobile }) => {
  await demo(page, true);
  const refresh = page.locator('.delivery-overview button').last();
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(refresh).toBeEnabled();
  await expect(refresh.locator('.refresh-glyph')).toHaveCSS('transform', 'none');
  await refresh.click();
  await expect(refresh).toBeEnabled();
  if (isMobile) {
    const surface = page.locator('.pull-refresh');
    await pull(surface, 190);
    await expect(surface).toHaveAttribute('data-phase', 'refreshing');
    await expect(surface.locator('.pull-refresh__content')).toHaveCSS('transform', 'none');
    await expect(surface.locator('.pull-refresh__arrow')).toHaveCSS('animation-name', 'none');
    await expect(surface).toHaveAttribute('data-phase', 'idle');
  }
});

test('captures a real touch pull without opening the card or scrolling the page', async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== 'chromium' || !isMobile, 'Real Chromium touch input');
  await demo(page);
  const client = await page.context().newCDPSession(page);
  const card = await page.locator('.parcel-card--hero').boundingBox();
  const x = Math.round(card!.x + card!.width / 2), y = Math.round(card!.y + 30);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let dy = 10; dy <= 200; dy += 10) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy }] });
  }
  await expect(page.locator('.pull-refresh')).toHaveAttribute('data-armed', 'true');
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.pull-refresh')).toHaveAttribute('data-phase', 'success');
  await expect(page.locator('.pull-refresh')).toHaveAttribute('data-phase', 'idle');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
