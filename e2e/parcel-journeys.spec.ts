import { expect, test, type Page } from '@playwright/test';

const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => { window.localStorage.clear(); window.localStorage.setItem('sdt.web.experience.v1', 'demo'); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle('French & Swiss Parcel Tracking | Delivery Tracker');
  // This control is rendered only after the client repository has loaded, so
  // it is also a stable signal that hydration and the first effect completed.
  await expect(page.getByRole('button', { name: 'Search & filters' })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

test('finds, filters, and opens a parcel', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'Search parcels' });
  await expect(search).toBeHidden();
  await page.getByRole('button', { name: 'Search & filters' }).click();
  await expect(search).toBeFocused();
  await search.fill('birthday');
  await page.keyboard.press('Escape');
  await expect(search).toBeHidden();
  const toggle = page.getByRole('button', { name: 'Search & filters' });
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAccessibleDescription('Custom view');
  await toggle.click();
  await expect(search).toHaveValue('birthday');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await search.fill('birthday');
  await expect(
    page.getByRole('region', { name: 'Needs attention' }).getByText('Birthday gift 🎁'),
  ).toBeVisible();
  await expect(page.locator('.parcel-sections').getByText('Coffee beans ☕')).toHaveCount(0);
  await expect(page.getByText('1 shown')).toBeVisible();

  await search.fill('');
  await page.getByLabel('Status').selectOption('delivered');
  await expect(page.getByText('Coffee beans ☕')).toBeVisible();
  await page.getByText('Coffee beans ☕').click();
  await expect(page.getByRole('dialog', { name: 'Coffee beans ☕' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Tracking history' }))
    .toHaveAttribute('aria-label', 'Tracking history');
});

test('carefully deletes an active parcel from its detail screen', async ({ page }) => {
  await page.getByRole('button', { name: /^(?:Next up: )?New sneakers 👟 —/ }).click();
  const detail = page.getByRole('dialog', { name: 'New sneakers 👟' });
  await detail.getByLabel('Parcel actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();

  let confirmation = page.getByRole('dialog', {
    name: /permanently delete new sneakers/i,
  });
  await expect(confirmation).toContainText('cannot be undone');
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  await expect(detail).toBeVisible();

  await detail.getByLabel('Parcel actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  confirmation = page.getByRole('dialog', { name: /permanently delete new sneakers/i });
  await confirmation.getByRole('button', { name: 'Delete permanently' }).click();

  await expect(page.getByRole('status')).toContainText('New sneakers 👟 permanently deleted');
  await expect(detail).toBeHidden();
});

test('adds a parcel from tracking text', async ({ page }) => {
  await page.getByRole('button', { name: 'Add a parcel' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a parcel' });
  await sheet.getByLabel(/^Title/).fill('Fondue set');
  await sheet.getByLabel('Tracking number or link').fill('Track 99.34.111111.22222222');
  await expect(sheet.getByText('Swiss Post', { exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Add parcel' }).click();

  await expect(page.getByText('Fondue set')).toBeVisible();
  await expect(sheet).toBeHidden();
  const burst = page.locator('.parcel-added-burst');
  await expect(burst).toBeVisible();
  await expect(burst).toHaveAttribute('aria-hidden', 'true');
  const card = page.locator('.parcel-card-swipe').filter({ hasText: 'Fondue set' });
  await expect(card).toBeInViewport();
  await expect(card).toHaveAttribute('data-celebrating', 'rumble');
  await expect(burst).toHaveAttribute('data-parcel-id', (await card.getAttribute('data-parcel-id'))!);
  await expect(card.locator('.parcel-card')).toBeFocused();
  const anchorDistance = await card.evaluate((element) => {
    const stamp = element.querySelector('.parcel-card__stub, .postage-stamp')!.getBoundingClientRect();
    const burst = document.querySelector<HTMLElement>('.parcel-added-burst')!;
    return Math.hypot(parseFloat(burst.style.getPropertyValue('--burst-x')) - stamp.x - stamp.width / 2,
      parseFloat(burst.style.getPropertyValue('--burst-y')) - stamp.y - stamp.height / 2);
  });
  expect(anchorDistance).toBeLessThan(6);
  expect(await burst.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(burst).toHaveCount(0);
});

test('parcel celebration respects reduced motion and clears before the next interaction', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Add a parcel' }).click();
  let sheet = page.getByRole('dialog', { name: 'Add a parcel' });
  await sheet.getByLabel('Tracking number or link').fill('99.34.111111.22222222');
  await sheet.getByRole('button', { name: 'Add parcel' }).click();
  const burst = page.locator('.parcel-added-burst');
  await expect(burst).toHaveAttribute('data-reduced', 'true');
  const card = page.locator('.parcel-card-swipe[data-celebrating="highlight"]');
  await expect(card).toBeInViewport();
  expect(await card.evaluate((element) => element.getAnimations()
    .every((animation) => (animation.effect as KeyframeEffect).getKeyframes()
      .every((frame) => frame.transform === undefined)))).toBe(true);
  expect(await burst.evaluate((element) => element.getAnimations({ subtree: true })
    .every((animation) => (animation.effect as KeyframeEffect).getKeyframes()
      .every((frame) => frame.transform === undefined)))).toBe(true);
  // The decorative layer must let the next tap through, and leave no stale burst.
  await page.getByRole('button', { name: 'Add a parcel' }).click();
  await expect(burst).toHaveCount(0);
  sheet = page.getByRole('dialog', { name: 'Add a parcel' });
  await sheet.getByLabel('Tracking number or link').fill('99.34.111111.22222222');
  await sheet.getByRole('button', { name: 'Add parcel' }).click();
  await expect(sheet.getByRole('alert')).toContainText('already tracking this parcel');
  await expect(burst).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(burst).toHaveCount(0);
});

test('reveals the added card from another tab even when delivery filters hide it', async ({ page }) => {
  await page.getByRole('button', { name: 'Search & filters' }).click();
  await page.getByRole('searchbox', { name: 'Search parcels' }).fill('birthday');
  await page.locator('.app__navigation').getByRole('button', { name: 'Passport' }).click();
  await page.getByRole('button', { name: 'Add a parcel' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a parcel' });
  await sheet.getByLabel(/^Title/).fill('A new adventure');
  await sheet.getByLabel('Tracking number or link').fill('99.34.111111.33333333');
  await sheet.getByRole('button', { name: 'Add parcel' }).click();
  const card = page.locator('.parcel-card-swipe').filter({ hasText: 'A new adventure' });
  await expect(page.locator('.app__navigation').getByRole('button', { name: 'Deliveries' })).toHaveAttribute('aria-current', 'page');
  await expect(card).toHaveAttribute('data-celebrating', 'rumble');
  await expect(card).toBeInViewport();
  await card.locator('.parcel-card').click();
  await expect(page.getByRole('dialog', { name: 'A new adventure' })).toBeVisible();
  await expect(page.locator('.parcel-added-burst')).toHaveCount(0);
});

test('opens unknown postal tracking on 17TRACK in the selected language', async ({ page }) => {
  await page.getByRole('button', { name: 'Add a parcel' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a parcel' });
  await sheet.getByLabel(/^Title/).fill('Postal shipment');
  await sheet.getByLabel('Tracking number or link').fill('RA123456785DE');
  await expect(sheet.getByText('Unknown postal carrier', { exact: true })).toBeVisible();
  await expect(sheet.getByText(/Automatic updates aren’t available. Check 17TRACK/)).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Add parcel' }).click();
  await page.getByRole('button', { name: /^(?:Next up: )?Postal shipment —/ }).click();
  let detail = page.getByRole('dialog', { name: 'Postal shipment' });
  const link = detail.getByRole('link', { name: 'Open on 17TRACK ↗' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://t.17track.net/en#nums=RA123456785DE');
  await expect(detail.getByRole('button', { name: 'Check now', exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Change carrier from Unknown postal carrier' })).toBeVisible();
  await detail.getByRole('button', { name: 'Back', exact: true }).click();

  await page.locator('.account-trigger').click();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('fr');
  await page.keyboard.press('Escape');
  await expect(page.locator('.settings-sheet')).toBeHidden();
  await page.getByRole('button', { name: /^(?:Next up: )?Postal shipment —/ }).click();
  detail = page.getByRole('dialog', { name: 'Postal shipment' });
  await expect(detail.getByRole('button', { name: /Transporteur postal inconnu/ })).toBeVisible();
  const frenchLink = detail.getByRole('link', { name: 'Ouvrir sur 17TRACK ↗' });
  await expect(frenchLink).toBeVisible();
  await expect(frenchLink).toHaveAttribute('href', 'https://t.17track.net/fr#nums=RA123456785DE');
  await expect(detail.getByText(/Consultez 17TRACK ou choisissez le transporteur/)).toHaveCount(0);
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
});

test('keeps invalid tracking input safely in the add sheet', async ({ page }) => {
  await page.getByRole('button', { name: 'Add a parcel' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a parcel' });
  await sheet.getByLabel('Tracking number or link').fill('hello there');

  await expect(sheet.getByText(/couldn't find a tracking number/i)).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Add parcel' })).toBeDisabled();
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
});

test('navigates nested carrier dialogs entirely by keyboard', async ({ page }) => {
  const parcel = page.getByRole('button', { name: /^(?:Next up: )?New sneakers 👟 —/ });
  await parcel.click();
  const detail = page.getByRole('dialog', { name: 'New sneakers 👟' });
  // Closed details-menu actions must not enter the Tab order.
  await page.keyboard.press('Tab');
  await expect(detail.getByLabel('Parcel actions', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(detail.getByRole('button', { name: 'Delete permanently' })).toBeHidden();

  const changeCarrier = detail.getByRole('button', { name: 'Change carrier from DHL' });
  await changeCarrier.click();
  const sheet = page.getByRole('dialog', { name: 'Change carrier' });
  const carrier = sheet.getByRole('combobox', { name: 'Carrier' });
  await expect(carrier).toBeFocused();
  await carrier.selectOption('dpd');
  await page.keyboard.press('Tab');
  const postcode = sheet.getByLabel(/postcode/i);
  await expect(postcode).toBeFocused();
  await postcode.fill('8000');
  await page.keyboard.press('Tab');
  await expect(sheet.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(sheet.getByRole('button', { name: 'Save carrier', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(carrier).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(changeCarrier).toBeFocused();
  await expect(detail).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
  await expect(parcel).toBeFocused();
});

test('keeps translated add-parcel guidance readable in every app language', async ({ page }) => {
  // Change away from the initial English value first: selecting an unchanged
  // option does not emit a change event or save a language preference.
  for (const [locale, action, title, cancel] of [
    ['de', 'Ein Paket hinzufügen', 'Paket hinzufügen', 'Abbrechen'],
    ['fr', 'Ajouter un colis', 'Ajouter un colis', 'Annuler'],
    ['it', 'Aggiungi un pacco', 'Aggiungi un pacco', 'Annulla'],
    ['en', 'Add a parcel', 'Add a parcel', 'Cancel'],
  ]) {
    await page.locator('.account-trigger').click();
    await page.locator('.language-control select').selectOption(locale);
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-sheet')).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await page.getByRole('button', { name: action, exact: true }).click();
    const sheet = page.getByRole('dialog', { name: title });
    await sheet.locator('#add-parcel-tracking').fill('99.34.111111.22222222');
    await expect(sheet.getByText('Swiss Post', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await sheet.getByRole('button', { name: cancel, exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem('deliveryTrackerLocale'))).toBe(locale);
  }
});
