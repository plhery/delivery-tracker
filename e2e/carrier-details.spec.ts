import { expect, test } from '@playwright/test';
import type { ParcelWithEvents } from '../src/types';

test('localizes carrier details and opens the missing-input editor without overflow', async ({ page }, testInfo) => {
  const now = new Date();
  const date = (days: number) => new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
  const parcel: ParcelWithEvents = {
    id: 'carrier-details', carrier: 'heppner', trackingNumber: '12345678', label: 'Livraison bureau',
    createdAt: now.toISOString(), syncStatus: 'error', syncError: 'carrier:input_required',
    expectedDeliveryFrom: date(1), expectedDelivery: date(3),
    pickupPoint: 'Librairie du quartier\n12 avenue des Alpes, 1000 Lausanne',
    receiverName: 'Alex Martin', weightKg: 1.25, dimensionsText: '20 × 30 × 10 cm',
    events: [{ id: 'scan', parcelId: 'carrier-details', stage: 'in_transit', description: 'Delivery appointment updated', occurredAt: now.toISOString() }],
  };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(item => {
    localStorage.setItem('sdt.web.experience.v1', 'demo');
    localStorage.setItem('sdt.demo.catalog.v2', '1');
    localStorage.setItem('deliveryTrackerLocale', 'fr');
    localStorage.setItem('sdt.demo.parcels.v1', JSON.stringify([item]));
  }, parcel);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Livraison bureau —/ }).click();
  const detail = page.locator('.detail--postcard');
  await expect(detail.getByText('Lieu de retrait', { exact: true })).toBeVisible();
  await expect(detail.getByText('Alex Martin', { exact: true })).toBeVisible();
  await expect(detail.getByText('Rendez-vous de livraison modifié', { exact: true })).toBeVisible();
  await expect(detail.locator('.detail__arrival')).toContainText('demain –');
  await expect(detail).not.toContainText('carrier:input_required');
  expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await detail.screenshot({ path: `/tmp/carrier-details-${testInfo.project.name}.png` });
  await detail.getByRole('button', { name: 'Compléter les informations de suivi' }).click();
  await expect(page.locator('.change-carrier-sheet')).toBeVisible();
  expect(errors).toEqual([]);
});
