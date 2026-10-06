import { expect, test, type Page } from '@playwright/test';
import type { ParcelWithEvents, Stage } from '../src/types';

test.use({ locale: 'en-US' });

const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  failures.set(page, []);
  page.on('pageerror', (error) => failures.get(page)!.push(error.message));
});
test.afterEach(async ({ page }) => { expect(failures.get(page)).toEqual([]); });

const HOUR = 3_600_000;
function parcel(id: string, label: string, stages: Stage[]): ParcelWithEvents {
  const now = Date.now();
  return {
    id, label, carrier: 'dhl', trackingNumber: `TRACK${id}`, createdAt: new Date(now - 90 * HOUR).toISOString(), syncStatus: 'ok',
    events: stages.map((stage, index) => ({ id: `${id}-${stage}`, parcelId: id, stage, description: stage, occurredAt: new Date(now - (stages.length - index) * 6 * HOUR).toISOString() })),
  };
}

/**
 * The demo with a tea that is out for delivery: its next check delivers it. `held` keeps the card's flight
 * at its first moment, so that the test can look at it and end it when it has.
 */
async function demo(page: Page, held = false) {
  await page.addInitScript(([parcels, held]) => {
    localStorage.setItem('sdt.web.experience.v1', 'demo');
    localStorage.setItem('sdt.demo.parcels.v1', JSON.stringify(parcels));
    if (!held) return;
    const animate = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (typeof options === 'object' && options.id?.startsWith('delivered-')) {
        animation.pause();
        animation.currentTime = 0;
      }
      return animation;
    };
  }, [[
    parcel('tea', 'Tea', ['accepted', 'in_transit', 'out_for_delivery']),
    parcel('lamp', 'Lamp', ['accepted']),
    parcel('vase', 'Vase', ['registered']),
    parcel('book', 'Book', ['accepted', 'in_transit', 'out_for_delivery', 'delivered']),
  ], held] as const);
  await page.goto('/');
  await expect(page.locator('.delivery-next [data-parcel-id="tea"]')).toBeVisible();
}

/** The list's own refresh button is not shown on a touch screen, where the list is pulled: it is pressed from the page. */
const check = (page: Page) => page.evaluate(() => document.querySelector<HTMLButtonElement>('.delivery-refresh')!.click());

const box = (page: Page, selector: string) => page.locator(selector).evaluate((element) => {
  const bounds = element.getBoundingClientRect();
  return { x: bounds.left, y: bounds.top + window.scrollY, width: bounds.width, height: bounds.height };
});

test('a delivered parcel says so where its card stands, then the card travels to the past deliveries', async ({ page }) => {
  await demo(page, true);
  const next = page.locator('.delivery-next [data-parcel-id="tea"]');
  await check(page);

  // The news, in place: the card is still Next up in all but name.
  await expect(next).toHaveAttribute('data-arrived', '');
  // The page itself has finished coming in, so the card is where it will be let go from.
  await page.locator('.deliveries-page').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const stood = await box(page, '.delivery-next [data-parcel-id="tea"]');
  await expect(next.locator('.parcel-card__summary')).toContainText('Delivered');
  await expect(next.locator('.parcel-card__next-label')).toBeHidden();
  await expect(next.locator('.parcel-stamp__postmark')).toBeVisible();
  await expect(page.getByRole('region', { name: 'On the way' }).locator('.parcel-section__heading > span')).toHaveText('3');
  await expect(page.locator('.parcel-section--past [data-parcel-id="tea"]')).toHaveCount(0);

  // Then it is let go: the card it was flies from where it stood, and the page's own card waits unseen.
  const flight = page.locator('.delivered-move').last();
  await expect(flight).toBeVisible();
  await expect(page.locator('.delivered-move')).toHaveCount(2);
  const arrived = page.locator('.parcel-section--past [data-parcel-id="tea"]');
  await expect(arrived).toHaveCSS('opacity', '0');
  const start = await box(page, '.delivered-move:last-child');
  expect(Math.abs(start.x - stood.x)).toBeLessThan(2);
  expect(Math.abs(start.y - stood.y)).toBeLessThan(2);
  expect(start.height).toBeGreaterThanOrEqual(stood.height - 1);
  await expect(page.getByRole('region', { name: 'On the way' }).locator('.parcel-section__heading > span')).toHaveText('2');
  // Nothing of it reaches past the sides of the page.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // The parcel has one card that answers for it: the one in the page.
  await expect(page.locator('[data-parcel-id="tea"]')).toHaveCount(1);

  // At the end of its flight the box stands on the page's card, and is taken away.
  await page.evaluate(() => document.getAnimations().filter((animation) => animation.id === 'delivered-flight').forEach((animation) => animation.finish()));
  // The list under it glides for a moment longer; once it rests, the two are in the same place.
  await expect.poll(async () => {
    const landed = await box(page, '.delivered-move:last-child');
    const place = await box(page, '.parcel-section--past [data-parcel-id="tea"]');
    return Math.max(Math.abs(landed.x - place.x), Math.abs(landed.y - place.y));
  }).toBeLessThan(2);
  await page.evaluate(() => document.getAnimations().filter((animation) => animation.id?.startsWith('delivered-')).forEach((animation) => animation.finish()));
  await expect(page.locator('.delivered-moves')).toHaveCount(0);
  await expect(arrived).toHaveCSS('opacity', '1');
  await expect(arrived).not.toHaveAttribute('data-arrived');
  await expect(page.locator('.delivery-next .parcel-card-swipe')).toHaveCount(1);
  await expect(page.locator('.delivery-next [data-parcel-id="tea"]')).toHaveCount(0);
});

test('a tap on the card that has just arrived opens that parcel', async ({ page }) => {
  await demo(page);
  await check(page);
  const next = page.locator('.delivery-next [data-parcel-id="tea"]');
  await expect(next).toHaveAttribute('data-arrived', '');
  await next.locator('.parcel-card').click();
  await expect(page.getByRole('dialog', { name: 'Tea', exact: true })).toBeVisible();
  // Under its page the list has settled, with no flight to see.
  await expect(page.locator('.parcel-section--past [data-parcel-id="tea"]')).toHaveCount(1);
  await expect(page.locator('[data-arrived], .delivered-moves')).toHaveCount(0);
});

test('the list changes at once for someone who asked for less motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await demo(page);
  await page.evaluate(() => new MutationObserver(() => {
    if (document.querySelector('[data-arrived], .delivered-moves')) document.body.dataset.moved = '';
  }).observe(document.body, { subtree: true, childList: true, attributes: true }));
  await check(page);
  await expect(page.locator('.parcel-section--past [data-parcel-id="tea"]')).toBeVisible();
  await expect(page.locator('body')).not.toHaveAttribute('data-moved');
});
