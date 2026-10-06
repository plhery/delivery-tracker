import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({ locale: 'en-US' });

const hold = (sheet: Locator, time: number) => sheet.evaluate((element, at) => element.getAnimations().forEach((animation) => {
  animation.pause();
  animation.currentTime = at;
}), time);
const settle = (sheet: Locator) => sheet.evaluate((element) => Promise.all(element.getAnimations().map((animation) => {
  animation.finish();
  return animation.finished;
})));

// A busy machine can spend a whole movement before the test looks: every movement of these
// elements waits, paused, for the test to place it.
const holdMotion = (page: Page, selector: string) => page.addInitScript((held) => {
  const matches = (target: Node): target is Element => target instanceof Element && target.matches(held);
  new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
    if (!(node instanceof Element)) return;
    [node, ...node.querySelectorAll(held)].filter(matches).forEach((element) => element.getAnimations().forEach((animation) => animation.pause()));
  }))).observe(document, { childList: true, subtree: true });
  const animate = Element.prototype.animate;
  Element.prototype.animate = function heldAnimate(...frames) {
    const animation = animate.apply(this, frames);
    if (matches(this)) animation.pause();
    return animation;
  };
}, selector);

async function rises(page: Page, sheet: Locator) {
  const height = page.viewportSize()!.height;
  await expect(sheet).toBeAttached();
  await hold(sheet, 0);
  // The whole sheet starts under the bottom edge, opaque, and nothing scrolled to meet its focused control.
  expect((await sheet.boundingBox())!.y).toBeGreaterThanOrEqual(height - 1);
  expect(await sheet.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  expect(await sheet.evaluate((element) => [element.parentElement!.scrollTop, window.scrollY])).toEqual([0, 0]);
  await hold(sheet, 120);
  const travelling = (await sheet.boundingBox())!.y;
  expect(travelling).toBeGreaterThan(40);
  expect(travelling).toBeLessThan(height - 40);
  await settle(sheet);
  const rest = await sheet.boundingBox();
  expect(rest!.y + rest!.height).toBeGreaterThan(height - 1);
}

test('sheets rise from the bottom edge on phones and leave the same way', async ({ page }) => {
  test.skip(page.viewportSize()!.width > 760, 'Wide screens show sheets as centred dialogs.');
  await page.addInitScript(() => localStorage.setItem('sdt.web.experience.v1', 'demo'));
  await holdMotion(page, '.sheet');
  await page.goto('/');

  await page.locator('.account-trigger').click();
  const settings = page.locator('.settings-sheet');
  await rises(page, settings);
  await settings.getByRole('button', { name: 'Close' }).click();
  await hold(settings, 130);
  expect(await settings.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  expect((await settings.boundingBox())!.y).toBeGreaterThan(await settings.evaluate((element) => element.offsetTop));
  await settle(settings);
  await expect(settings).toHaveCount(0);

  await page.locator('.app__add-button').click();
  const add = page.locator('.add-parcel-sheet');
  await hold(add, 0);
  // The full-screen form does not paint over the list before it has arrived.
  expect(await add.evaluate((element) => getComputedStyle(element).boxShadow)).not.toContain('0px 0px 0px');
  await rises(page, add);
  expect(await add.evaluate((element) => getComputedStyle(element).boxShadow)).toContain('0px 0px 0px');
  await expect(add.getByRole('textbox').first()).toBeFocused();
});

test('a stamp’s bubble grows out of it, and a friend’s page out of their card', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sdt.web.experience.v1', 'demo'));
  await page.goto('/');
  const navigation = page.locator('.app__navigation');

  await navigation.getByRole('button', { name: 'Passport', exact: true }).click();
  const stamp = page.locator('.stamp-card').first();
  // The page has arrived before the stamp is measured.
  await page.locator('.passport-page').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  await stamp.click();
  const bubble = page.locator('.passport-bubble[data-positioned]');
  await expect(bubble).toBeVisible();
  // The stamp itself keeps still; the bubble starts small, on the stamp's side.
  expect(await stamp.locator('.passport-seal').evaluate((element) => element.getAnimations().length)).toBe(0);
  const from = await bubble.evaluate((element) => {
    const [x, y] = getComputedStyle(element).transformOrigin.split(' ').map(Number.parseFloat);
    const box = { left: element.offsetLeft, top: element.offsetTop };
    return { x: box.left + x, y: box.top + y, growing: element.getAnimations().some((animation) => (animation as CSSTransition).transitionProperty === 'scale') };
  });
  const seal = (await stamp.boundingBox())!;
  expect(from.growing).toBe(true);
  expect(Math.abs(from.x - (seal.x + seal.width / 2))).toBeLessThan(2);
  expect(Math.abs(from.y - (seal.y + seal.height / 2))).toBeLessThan(2);
  await bubble.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const rest = (await bubble.boundingBox())!;
  expect(rest.x).toBeGreaterThanOrEqual(11);
  expect(rest.x + rest.width).toBeLessThanOrEqual(page.viewportSize()!.width - 11);
  await page.keyboard.press('Escape');

  await navigation.getByRole('button', { name: 'Friends', exact: true }).click();
  const card = page.locator('.friend-card').nth(1);
  await card.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
  const tone = await card.evaluate((element) => getComputedStyle(element).backgroundColor);
  const place = (await card.boundingBox())!;
  await card.click();
  const friend = page.locator('.friends-sheet--page');
  await expect.poll(() => friend.evaluate((element) => element.getAnimations().some((animation) => animation.id === 'parcel-card-expand'))).toBe(true);
  await friend.evaluate((element) => element.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = 0; }));
  // The page starts as the card: its coloured block, in the card's colour, stands where the card is.
  const postcard = friend.locator('.friend-postcard');
  expect(await postcard.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(tone);
  const start = (await postcard.boundingBox())!;
  if (page.viewportSize()!.width <= 760) {
    // The block is taller than the card: it starts at the card's top, as wide as the card.
    expect(Math.abs(start.x - place.x)).toBeLessThan(2);
    expect(Math.abs(start.width - place.width)).toBeLessThan(2);
    expect(Math.abs(start.y - place.y)).toBeLessThan(12);
  }
  await friend.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));
  await friend.getByRole('button', { name: 'Close' }).click();
  await expect.poll(() => friend.evaluate((element) => element.getAnimations().some((animation) => animation.id === 'detail-card-return'))).toBe(true);
  await friend.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));
  await expect(friend).toHaveCount(0);
  await expect(card).toBeFocused();
});

test('search folds open over the list and folds shut again', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sdt.web.experience.v1', 'demo'));
  await holdMotion(page, '.parcel-view-shell');
  await page.goto('/');

  const toggle = page.locator('.delivery-search');
  const list = page.locator('.parcel-card').first();
  await expect(list).toBeVisible();
  // The entrance has to be over; looping animations never finish and are left alone.
  await page.locator('.deliveries-page').evaluate((element) => Promise.all(element.getAnimations({ subtree: true })
    .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
    .map((animation) => animation.finished)));
  const before = (await list.boundingBox())!.y;
  await toggle.click();
  const shell = page.locator('.parcel-view-shell');
  await hold(shell, 0);
  // Nothing jumps: the list starts where it was and is pushed down as the field unfolds.
  expect(Math.abs((await list.boundingBox())!.y - before)).toBeLessThan(2);
  expect((await shell.boundingBox())!.height).toBeLessThan(2);
  await settle(shell);
  const open = (await list.boundingBox())!.y;
  expect(open).toBeGreaterThan(before + 40);
  // The count only takes a line once the list has been narrowed.
  const count = page.locator('.parcel-view__meta');
  expect((await count.boundingBox())!.height).toBeLessThan(2);
  await page.getByRole('searchbox').fill('dhl');
  await expect.poll(async () => (await count.boundingBox())!.height).toBeGreaterThan(12);
  await page.getByRole('searchbox').fill('');

  await toggle.click();
  await expect.poll(() => shell.evaluate((element) => element.getAnimations().length)).toBeGreaterThan(0);
  await hold(shell, 110);
  const closing = (await list.boundingBox())!.y;
  expect(closing).toBeLessThan(open - 4);
  expect(closing).toBeGreaterThan(before + 4);
  await settle(shell);
  await expect(shell).toHaveCount(0);
  expect(Math.abs((await list.boundingBox())!.y - before)).toBeLessThan(2);
});
