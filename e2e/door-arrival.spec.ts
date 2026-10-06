import { expect, test, type Page } from '@playwright/test';
import { track } from './peek';

test.use({ locale: 'en-US' });

const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  failures.set(page, []);
  page.on('pageerror', (error) => failures.get(page)!.push(error.message));
});
test.afterEach(async ({ page }) => { expect(failures.get(page)).toEqual([]); });

/**
 * The door with two parcels of this device: one out for delivery, which leads the list on the card with
 * the map, and one still on its way. A finger comes down as the news of a delivery shows, under which the
 * list stays as it is until `lift`; what the paper was made of is noted, since it is gone within seconds.
 */
async function door(page: Page) {
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.querySelector('[data-arrived]')) document.body.dataset.news = '';
      const paper = document.querySelector('.delivered-confetti');
      if (paper && !document.body.dataset.paper) {
        document.body.dataset.paper = [paper.querySelectorAll(':scope > i').length, paper.querySelectorAll(':scope > svg').length, getComputedStyle(paper).pointerEvents].join(' ');
      }
      if (document.querySelector('.delivered-move')) document.body.dataset.flown = '';
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-arrived'] });
    new MutationObserver((_, observer) => {
      if (!document.querySelector('[data-arrived]')) return;
      observer.disconnect();
      window.dispatchEvent(new PointerEvent('pointerdown'));
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-arrived'] });
  });
  await track(page, 'DEMOGLS20260001');
  await expect(page.getByRole('heading', { level: 1, name: 'In transit' })).toBeVisible();
  await track(page, 'DEMOCHOC20260001');
  await expect(page.getByRole('heading', { level: 1, name: 'Out for delivery' })).toBeVisible();
  await page.goto('/');
  await expect(page.locator('li > .door-nextup')).toContainText('Out for delivery');
  await expect(page.locator('li > .door-nextup [data-pip]')).toHaveAttribute('data-pip', 'eager');
  await expect(page.locator('li > .door-parcel')).toContainText('In transit');
}

/** The device learns that the parcel leading its list was delivered, as it does when it asks again. */
const deliver = (page: Page) => page.evaluate(() => {
  const KEY = 'sdt.peek.parcels.v1';
  const list = JSON.parse(localStorage.getItem(KEY)!);
  const recent = list.find((entry: { id: string }) => entry.id === document.querySelector('.door-nextup')!.getAttribute('data-parcel-link'));
  const { events } = recent.snapshot.parcel;
  const last = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).at(-1);
  events.push({ ...last, id: `${last.id}-delivered`, stage: 'delivered', description: 'Delivered', occurredAt: new Date().toISOString() });
  recent.stage = 'delivered';
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
});

const lift = (page: Page) => page.evaluate(() => { window.dispatchEvent(new PointerEvent('pointerup')); });

test('a parcel of this device that has arrived says so on the card that leads the list, then makes way for the next', async ({ page }) => {
  await door(page);
  await deliver(page);

  // The news, in place: the same card leads, Pip's box opens on its map and paper comes out of it.
  const lead = page.locator('li > .door-nextup');
  await expect(lead).toHaveAttribute('data-arrived', '');
  await expect(lead.locator('strong')).toHaveText('Delivered');
  await expect(lead.locator('[data-pip]')).toHaveAttribute('data-pip', 'joy');
  await expect(page.locator('li > .door-parcel')).toContainText('In transit');
  await expect(page.locator('body')).toHaveAttribute('data-paper', '58 6 none');

  // The cards in the list itself are told from the pictures of them that fly over it.
  // Let go, its card travels to its place among the others, and the parcel still on its way leads.
  await lift(page);
  await expect(page.locator('body')).toHaveAttribute('data-flown', '');
  await expect(lead).toContainText('In transit');
  await expect(lead).not.toHaveAttribute('data-arrived');
  await expect(page.locator('li > .door-parcel')).toContainText('Delivered');
  await expect(page.locator('.door-device [data-parcel-link]')).toHaveCount(2);
  await expect(page.locator('.delivered-moves, .delivered-confetti')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the door’s list changes at once for someone who asked for less motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await door(page);
  await deliver(page);
  await expect(page.locator('li > .door-nextup')).toContainText('In transit');
  await expect(page.locator('li > .door-parcel')).toContainText('Delivered');
  await expect(page.locator('body')).not.toHaveAttribute('data-news');
  await expect(page.locator('body')).not.toHaveAttribute('data-paper');
});
