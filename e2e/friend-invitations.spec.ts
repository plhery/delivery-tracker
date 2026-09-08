import { expect, test } from '@playwright/test';

const token = 'ab'.repeat(16);
const preview = 'Ab7kP2mQ9xR4tY6n';
// These tests stub the server response; worker-owned requests bypass routing in WebKit.
test.use({ locale: 'en-US', serviceWorkers: 'block' });

test('social crawlers and browser-like preview readers receive a parcel card in the initial HTML head', async ({ request }) => {
  test.skip(test.info().project.name !== 'desktop-chromium');
  for (const userAgent of [
    'WhatsApp/2.24',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Twitterbot/1.0',
    'Facebot',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'DeliveryPreviewReader/1.0',
  ]) {
    const response = await request.get('/i/' + preview, { headers: { 'user-agent': userAgent } });
    expect(response.ok()).toBe(true);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
    const html = await response.text();
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain('property="og:title" content="A friend sent you an invitation"');
    expect(head).toContain('name="twitter:card" content="summary_large_image"');
    expect(head).toContain(`/api/friends/invite-image?preview=${preview}`);
    expect(head).toMatch(new RegExp(`property="og:url" content="https?://[^"]+/i/${preview}"`));
  }
  const image = await request.get('/api/friends/invite-image');
  expect(image.headers()['content-type']).toBe('image/png');
  expect(image.headers()['cache-control']).toContain('no-store');
  const png = await image.body();
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
});

for (const suffix of ['', '?fbclid=tracking#discardable']) test(`a shared link (${suffix || 'bare'}) opens into personalized sign-in and survives a return visit`, async ({ page }) => {
  const errors: string[] = [];
  const urls: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => urls.push(request.url()));
  await page.addInitScript(() => localStorage.setItem('sdt.web.experience.v1', 'demo'));
  await page.route('**/api/friends/invite-preview', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ code: preview });
    await route.fulfill({ json: { previewNickname: 'Paul' } });
  });
  await page.goto(`/i/${preview}${suffix}`);
  await expect(page.getByRole('heading', { name: 'Your friend Paul sent you an invitation' })).toBeVisible();
  await expect(page).toHaveURL(/\/invite$/);
  await expect(page.getByRole('button', { name: /try the demo/i })).toHaveCount(0);
  await page.locator('.arrival__parcel').evaluate((element) => element.setAttribute('data-continuity', 'original'));
  await page.getByRole('button', { name: 'Tap to open your parcel' }).click();
  await expect(page.locator('.arrival')).toHaveClass(/arrival--opening/);
  await expect(page.locator('.arrival')).toHaveClass(/arrival--sign-in/);
  await expect(page.getByText('Sign in to accept the invitation')).toBeVisible();
  await expect(page.locator('.arrival__parcel')).toHaveAttribute('data-continuity', 'original');
  await page.screenshot({ path: `/tmp/invitation-${test.info().project.name}.png` });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your friend Paul sent you an invitation' })).toBeVisible();
  await expect(page.locator('.arrival')).toHaveClass(/arrival--sign-in/);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: 'Tap to open your parcel' })).toBeEnabled();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.arrival')).not.toHaveClass(/arrival--invitation/);
  expect(await page.evaluate(() => sessionStorage.getItem('sdt.pendingFriendInvitation.v1'))).toBeNull();
  expect(urls.some((url) => url.includes(token))).toBe(false);
  expect(errors).toEqual([]);
});

test('long sender names and expired invitations fit narrow screens in every locale', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone)' }));
  let expired = false;
  await page.route('**/api/friends/invite-preview', (route) => route.fulfill(expired ? { status: 404, json: { error: 'Invitation unavailable' } } : { json: { previewNickname: 'AlexandertheGreatestEver' } }));
  await page.goto(`/i/${preview}`);
  await expect(page.locator('.arrival__open')).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Open in iOS app' })).toHaveAttribute('href', `swissdeliverytracker://invite#${preview}`);
  for (const language of ['fr', 'de', 'it', 'en']) {
    await page.getByRole('combobox').selectOption(language);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.arrival__open')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.arrival__app-link')).toBeInViewport({ ratio: 1 });
    const heading = await page.locator('.arrival__welcome h1').boundingBox();
    const parcel = await page.locator('.arrival__parcel').boundingBox();
    expect(parcel!.y).toBeGreaterThan(heading!.y + heading!.height - 5);
  }
  await page.screenshot({ path: `/tmp/invitation-long-${test.info().project.name}.png` });
  expired = true;
  await page.reload();
  await expect(page.locator('.invitation-notice[role="alert"]')).toContainText('This invitation is no longer available');
  await expect(page.locator('.arrival__open')).toHaveCount(0);
  await expect(page.getByText('Tap to open your parcel')).toHaveCount(0);
  await expect(page.locator('.arrival__parcel')).toBeVisible();
  await expect(page.locator('.arrival')).toHaveClass(/arrival--welcome/);
  await expect(page.getByRole('button', { name: /Google|Become friends/ })).toHaveCount(0);
});
