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
  return page.locator('.account-menu');
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}
const frontDoor = (page: Page) => page.getByRole('heading', { name: 'Where’s my parcel?' });
/** The front door's own button; it is live once the page is. */
async function openSignIn(page: Page) {
  const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(signIn).toBeEnabled();
  await signIn.click();
}
/** An invitation still arrives as the closed parcel to open: the one place the welcome parcel stands. */
async function invitation(page: Page) {
  await page.route('**/api/friends/invite-preview', (route) => route.fulfill({ json: { previewNickname: 'Paul' } }));
  await page.goto('/i/Ab7kP2mQ9xR4tY6n');
  await expect(page.getByRole('button', { name: 'Tap to open your parcel' })).toBeEnabled();
}

test('opens the box on arriving at sign-in from the front door, then leaves demo without a reload', async ({ page }) => {
  await page.goto('/');
  await expect(frontDoor(page)).toBeVisible();
  await expect(page.getByRole('button', { name: /Explore the demo/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tap to open your parcel' })).toHaveCount(0);
  // Pip waits on the door, closed and looping.
  expect(await page.locator('.door .parcel-illustration__body').evaluate((element) => getComputedStyle(element).animationIterationCount)).toBe('infinite');
  await openSignIn(page);
  const arrival = page.locator('.arrival');
  // The box opens where sign-in keeps it: flaps folded back, the card raised, Pip's eyes happy.
  await expect(arrival).toHaveClass(/arrival--opening/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeFocused();
  await expect(arrival).toHaveClass(/arrival--sign-in/);
  await expect(arrival).not.toHaveClass(/arrival--opening/);
  await expect(page.locator('.arrival .parcel-illustration__delivery-card')).toHaveCSS('opacity', '1');
  await expect(page.locator('.arrival .parcel-illustration__happy-eye').first()).toHaveCSS('opacity', '1');
  await expect(page.locator('.arrival .parcel-illustration__tape')).toHaveCSS('opacity', '0');
  await page.getByRole('button', { name: 'Explore the demo' }).click();
  await expect(page.getByRole('heading', { name: 'Deliveries', exact: true })).toBeAttached();
  await page.getByRole('button', { name: 'Exit demo', exact: true }).click();
  await expect(frontDoor(page)).toBeVisible();
  await expect(page.getByRole('button', { name: /Explore the demo/ })).toHaveCount(0);
  expect(await page.locator('.door .parcel-illustration__body').evaluate((element) => getComputedStyle(element).animationIterationCount)).toBe('infinite');
  await page.reload();
  await expect(frontDoor(page)).toBeVisible();
  await expect(page.locator('.demo-banner')).toHaveCount(0);
});

test('offers sign-in with a compact card and returns to the front door', async ({ page }) => {
  await page.goto('/');
  await expect(frontDoor(page)).toBeVisible();
  await openSignIn(page);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeFocused();
  await expect(page.locator('.auth-flow--card')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explore the demo', exact: true })).toBeVisible();
  await noOverflow(page);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(frontDoor(page)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Tracking number or link' })).toBeVisible();
  await noOverflow(page);
  // The step is remembered: a reload stays on the front door.
  await page.reload();
  await expect(frontDoor(page)).toBeVisible();
});

test('leads every header with the name: the lockup where it stands alone, the mark beside a phone’s tab title', async ({ page }) => {
  await page.goto('/');
  const lockup = page.locator('header .peek-lockup');
  await expect(lockup).toHaveText('PeekUniversal Parcel Tracker');
  const place = await lockup.boundingBox();
  await openSignIn(page);
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
  await expect(page.getByLabel('Language')).toBeVisible();
  // The name keeps its place while the front door gives way to sign-in.
  await expect(page.locator('.arrival__header .peek-lockup')).toBeVisible();
  expect(await lockup.boundingBox()).toEqual(place);
  await noOverflow(page);
  await page.getByRole('button', { name: 'Explore the demo', exact: true }).click();
  const phone = page.viewportSize()!.width <= 760;
  await expect(page.locator('.app__brand > .peek-mark')).toBeVisible({ visible: phone });
  await expect(page.locator('.app__brand .peek-lockup')).toBeVisible({ visible: !phone });
  // The mark keeps its own size and colours beside the controls' line icons.
  const mark = page.locator('.app__brand .peek-mark:visible');
  await expect(mark).toHaveCSS('width', phone ? '30px' : '28px');
  await expect(mark).toHaveCSS('stroke', 'none');
  // The field stands under a phone's title row and inside a wide screen's header.
  await expect(page.getByRole('textbox', { name: 'Track a parcel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a parcel', exact: true })).toHaveCount(0);
});

test('Pip blinks on the front door’s closed parcel, and keeps still when motion is reduced', async ({ page }) => {
  await page.goto('/');
  const eyes = page.locator('.door .parcel-illustration__eye');
  await expect(eyes).toHaveCount(2);
  await expect(eyes.first()).toHaveCSS('animation-name', 'pip-blink');
  await expect(eyes.first()).toHaveCSS('animation-iteration-count', 'infinite');
  await expect(eyes.last()).toHaveCSS('animation-delay', '0.02s');
  await expect(page.locator('.door .parcel-illustration__happy-eye').first()).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(eyes.first()).toHaveCSS('animation-name', 'none');
});

// The invitation's answer is stubbed; a service worker would fetch it past the stub.
test.describe('the parcel to open', () => {
test.use({ serviceWorkers: 'block' });

test('gives the parcel bounded depth without moving the controls, and stops on opening', async ({ page, browserName }) => {
  await invitation(page);
  const arrival = page.locator('.arrival');
  const open = page.getByRole('button', { name: 'Tap to open your parcel' });
  const title = page.getByRole('heading', { name: 'Your friend Paul sent you an invitation' });
  const titleFrame = await title.boundingBox();
  const pose = () => arrival.evaluate((element) => Number((element as HTMLElement).style.getPropertyValue('--parcel-x')));
  await page.mouse.move(8, 220);
  await expect.poll(pose).toBeLessThan(-.7);
  expect(await title.boundingBox()).toEqual(titleFrame);
  await arrival.dispatchEvent('pointerleave');
  await expect.poll(pose).toBe(0);
  // WebKit gates even synthetic orientation events behind sensor permission;
  // it deliberately retains pointer/touch motion without showing a prompt.
  if (browserName !== 'webkit') {
    await page.evaluate(() => {
      for (const gamma of [0, 75]) {
        const event = new Event('deviceorientation');
        Object.assign(event, { beta: 0, gamma });
        window.dispatchEvent(event);
      }
    });
    await expect.poll(pose).toBe(1);
  }
  expect(await title.boundingBox()).toEqual(titleFrame);
  await noOverflow(page);
  await open.click();
  await expect(page.getByText('Sign in to accept the invitation')).toBeVisible();
  await page.mouse.move(8, 220);
  await page.evaluate(() => {
    const event = new Event('deviceorientation');
    Object.assign(event, { beta: 25, gamma: -25 });
    window.dispatchEvent(event);
  });
  await expect.poll(pose).toBe(0);
  await expect(page.locator('.arrival__tilt')).toHaveCSS('transform', 'none');
});

test('turns off active tilt immediately when reduced motion is enabled', async ({ page }) => {
  await invitation(page);
  await page.mouse.move(8, 220);
  const arrival = page.locator('.arrival');
  const pose = () => arrival.evaluate((element) => Number((element as HTMLElement).style.getPropertyValue('--parcel-x')));
  await expect.poll(pose).toBeLessThan(-.7);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(pose).toBe(0);
  await expect(arrival).toHaveAttribute('data-motion-paused', 'true');
  await page.mouse.move(280, 350);
  await expect(page.locator('.arrival__tilt')).toHaveCSS('transform', 'none');
  expect(await pose()).toBe(0);
});
});

test('keeps demo exit available from parcel details and account', async ({ page }) => {
  await demo(page);
  await page.getByText('Coffee beans ☕', { exact: true }).click();
  await page.getByRole('dialog', { name: 'Coffee beans ☕' }).getByRole('button', { name: 'Exit demo' }).click();
  await expect(frontDoor(page)).toBeVisible();
  await expect(page).not.toHaveURL(/parcel=/);
  await openSignIn(page);
  await page.getByRole('button', { name: 'Explore the demo' }).click();
  const account = await settings(page);
  await account.getByRole('button', { name: 'Demo & data' }).click();
  await account.getByRole('button', { name: 'Exit demo' }).click();
  await expect(frontDoor(page)).toBeVisible();
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
  await page.getByRole('button', { name: 'Livraisons', exact: true }).click();
  await page.getByRole('textbox', { name: 'Suivre un colis' }).press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Ajouter un colis' });
  await expect(sheet.locator('#add-parcel-tracking')).toBeFocused();
  await sheet.locator('#add-parcel-tracking').fill('993411111122222222');
  await expect(sheet.getByText('Swiss Post', { exact: true })).toBeVisible();
  await expect(sheet.getByText(/Nous consulterons automatiquement/)).toHaveCount(0);
  await noOverflow(page);
});

test('opens Passport explanation bubbles without moving the journal and restores focus', async ({ page }) => {
  await demo(page);
  await page.getByRole('button', { name: 'Passport', exact: true }).click();
  await expect(page.locator('.passport-cover__count')).toHaveText('10');
  await expect(page.locator('.passport-note')).toHaveCount(0);
  await expect(page.locator('.country-row')).toHaveCount(3);
  await expect(page.locator('.passport-count')).toHaveCount(0);
  await expect(page.locator('.stamp-card')).toHaveCount(12);
  // Allow subpixel rounding while the page's entrance transform settles.
  await expect.poll(() => page.locator('.stamp-card').evaluateAll((cards) => {
    const positions = cards.slice(0, 4).map((card) => card.getBoundingClientRect().top);
    return Math.max(...positions) - Math.min(...positions);
  })).toBeLessThan(0.01);
  await expect(page.getByText('Unlocked', { exact: true })).toHaveCount(0);
  const stamp = page.getByRole('button', { name: 'First arrival', exact: true });
  const explanation = page.locator(`[id="${await stamp.getAttribute('aria-controls')}"]`);
  await expect(explanation).toBeHidden();
  const height = (await page.locator('.passport-stamps').boundingBox())!.height;
  await stamp.evaluate((element) => element.setAttribute('data-kept', 'yes'));
  await stamp.focus();
  await page.keyboard.press('Enter');
  await expect(stamp).toHaveAttribute('aria-expanded', 'true');
  await expect(explanation).toContainText('Your first delivered parcel.');
  await expect(explanation).toBeVisible();
  // Transformed bounds can differ by floating-point rounding between frames.
  expect((await page.locator('.passport-stamps').boundingBox())!.height).toBeCloseTo(height, 2);
  await expect(stamp).toHaveAttribute('data-kept', 'yes');
  await expect(page.getByRole('dialog', { name: 'First arrival', exact: true })).toBeVisible();
  await expect(explanation).toBeFocused();
  await noOverflow(page);
  await page.keyboard.press('Escape');
  await expect(stamp).toHaveAttribute('aria-expanded', 'false');
  await expect(explanation).toBeHidden();
  await expect(stamp).toBeFocused();
  await page.goBack();
  await expect(page.locator('.deliveries-page')).toBeVisible();
});

test('anchors every Passport bubble within a narrow screen and explains the country heading', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await demo(page);
  await page.getByRole('button', { name: 'Passport', exact: true }).click();
  await expect(page.locator('.stamp-card')).toHaveCount(12);
  const cards = page.locator('.passport-page button[aria-haspopup="dialog"]');
  for (const card of await cards.all()) {
    await card.click();
    await expect(card).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(`[id="${await card.getAttribute('aria-controls')}"]`)).toBeVisible();
    await expect(page.locator('.passport-page button[aria-haspopup="dialog"][aria-expanded="true"]')).toHaveCount(1);
    const bubble = page.getByRole('dialog');
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toBeFocused();
    const bounds = (await bubble.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(12);
    expect(bounds.y).toBeGreaterThanOrEqual(12);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(308);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(728);
    await noOverflow(page);
    await page.keyboard.press('Escape');
    await expect(card).toHaveAttribute('aria-expanded', 'false');
    await expect(card).toBeFocused();
  }
  const heading = page.getByRole('heading', { name: 'First scanned in', exact: true }).getByRole('button');
  await expect(heading).toHaveText('First scanned in');
  await expect(page.locator('.passport-help')).toHaveCount(0);
  await heading.click();
  await expect(page.getByRole('dialog', { name: 'First scanned in' })).toContainText('Where the carrier first scanned');
  await page.locator('.app__title').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(heading).toHaveAttribute('aria-expanded', 'false');
  await heading.click();
  await heading.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('respects reduced motion while retaining every action', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await openSignIn(page);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  // Without motion the box is simply open.
  await expect(page.locator('.arrival')).not.toHaveClass(/arrival--opening/);
  await expect(page.locator('.arrival .parcel-illustration__delivery-card')).toHaveCSS('opacity', '1');
  expect(await page.locator('.parcel-illustration__body').evaluate((element) => getComputedStyle(element).animationIterationCount)).not.toBe('infinite');
  await page.getByRole('button', { name: 'Explore the demo' }).click();
  await page.getByRole('textbox', { name: 'Track a parcel' }).press('Enter');
  await expect(page.getByRole('dialog', { name: 'Add a parcel' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Deliveries', exact: true }).click();
  // What the field cannot read goes to the Add sheet as typed.
  const field = page.getByRole('textbox', { name: 'Track a parcel' });
  await field.fill('hello there');
  await noOverflow(page);
  await field.press('Enter');
  await expect(page.getByLabel('Tracking number or link')).toHaveValue('hello there');
  await expect(page.getByRole('button', { name: 'Add parcel', exact: true })).toBeDisabled();
  await noOverflow(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByText('Coffee beans ☕', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Coffee beans ☕' })).toBeVisible();
  await noOverflow(page);
});

test('scrolls from a card, reveals archive smoothly, and supports reversing the swipe', async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile || browserName !== 'chromium', 'Uses real Chromium touch input on the mobile layout.');
  await page.setViewportSize({ width: 390, height: 640 });
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
  const card = page.getByRole('button', { name: /^(?:Next up: )?Birthday gift 🎁 —/ });
  await card.scrollIntoViewIfNeeded();
  const initialScroll = await page.evaluate(() => scrollY);
  const box = await card.boundingBox();
  // Wait for native momentum to finish before resetting the scroll position.
  // Otherwise the remaining touch scroll can move the page after scrollTo.
  await Promise.all([
    page.evaluate(() => new Promise<void>((resolve) => {
      document.addEventListener('scrollend', () => resolve(), { once: true });
    })),
    swipe(box!.x + 100, box!.y + box!.height / 2, 6, -150),
  ]);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(initialScroll + 50);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await card.scrollIntoViewIfNeeded();
  const swipeBox = (await card.boundingBox())!;
  const x = swipeBox.x + 230; const y = swipeBox.y + swipeBox.height / 2;
  await swipe(x, y, -70, 3);
  await expect(card).toHaveCSS('transform', 'matrix(1, 0, 0, 1, -88, 0)');
  const archive = page.getByRole('button', { name: 'Archive Birthday gift 🎁', exact: true });
  await expect(archive).toBeVisible();
  await swipe(x - 88, y, 70, 2);
  await expect(card).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await expect(archive).toBeHidden();
  await swipe(x, y, -220, 1);
  await expect(page.getByRole('status')).toContainText('Birthday gift 🎁 archived');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Birthday gift 🎁', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
