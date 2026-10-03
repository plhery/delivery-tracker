import { expect, test, type Page } from '@playwright/test';

// The page a delivery email's opt-out link opens. The demo build sends no email and has no
// such API: the server is stood in for here, and the token is made up.
const TOKEN = 'synthetic.token-for_tests.0123456789'; // gitleaks:allow -- made-up token, never issued by a server
const LINK = `/email/off#t=${TOKEN}`;
const API = '/api/email/unsubscribe';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page)!.push(error.message));
  page.on('console', (message) => {
    // A refusal the test itself answers with is not a fault of the page.
    if (message.type() === 'error' && !message.location().url.endsWith(API)) errors.get(page)!.push(message.text());
  });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

const title = (page: Page) => page.getByRole('heading', { level: 1 });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

interface Posted { path: string; body: unknown }

/**
 * Stands in for the server and notes what the page sends. By default it keeps
 * what was asked for; `refuse` answers the next request with that status instead.
 */
async function server(page: Page, refuse: number[] = []) {
  const posted: Posted[] = [];
  // Every request of the page, to show the token travels in a body only.
  const addresses: string[] = [];
  page.on('request', (request) => addresses.push(request.url()));
  await page.route(`**${API}*`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataJSON() as { token?: string; enabled?: boolean };
    posted.push({ path: `${request.method()} ${url.pathname}${url.search}`, body });
    const status = refuse.shift();
    if (status) await route.fulfill({ status, json: { error: 'Refused by the test' } });
    else await route.fulfill({ json: { emailOnDelivery: body.enabled === true } });
  });
  return { posted, addresses };
}

test('asks first: opening the link sends nothing, and one press turns the email off', async ({ page }) => {
  const { posted, addresses } = await server(page);
  const response = await page.goto(LINK);
  // The link names one account: its page is never indexed and never leaves as a referrer.
  expect(response!.headers()['referrer-policy']).toBe('no-referrer');
  expect(response!.headers()['x-robots-tag']).toContain('noindex');
  await expect(title(page)).toHaveText('Turn off delivery emails?');
  await expect(page.getByText('Peek will stop emailing you when a parcel is delivered. Your notifications stay as they are.')).toBeVisible();
  await expect(button(page, 'Turn off')).toBeEnabled();
  await expect(page).toHaveTitle('Peek — Turn off delivery emails?');
  expect(await fits(page)).toBe(true);
  // A scanner that opens the link and runs its scripts changes nothing.
  await page.waitForTimeout(1_000);
  expect(posted).toEqual([]);
  expect(addresses.filter((address) => address.includes(TOKEN))).toEqual([]);

  await button(page, 'Turn off').click();
  await expect(title(page)).toHaveText('Delivery emails are off');
  await expect(page.getByText('Peek won’t email you when a parcel is delivered. Your notifications haven’t changed.')).toBeVisible();
  expect(posted).toEqual([{ path: `POST ${API}`, body: { token: TOKEN } }]);
  // The token went in the request's body, and in no address.
  expect(addresses.filter((address) => address.includes(TOKEN))).toEqual([]);
  expect(new URL(page.url()).search).toBe('');
  await expect(page.getByRole('link', { name: 'Open Peek' })).toHaveAttribute('href', '/');
});

test('turns the email back on with the same link, and off again', async ({ page }) => {
  const { posted } = await server(page);
  await page.goto(LINK);
  await button(page, 'Turn off').click();
  await button(page, 'Turn back on').click();
  await expect(title(page)).toHaveText('Delivery emails are back on');
  await expect(page.getByText('You’ll get one short email when a parcel is delivered.')).toBeVisible();
  await button(page, 'Turn off').click();
  await expect(title(page)).toHaveText('Delivery emails are off');
  expect(posted.map(({ body }) => body)).toEqual([{ token: TOKEN }, { token: TOKEN, enabled: true }, { token: TOKEN }]);
});

test('says a link without a usable token does not work, and sends nothing', async ({ page }) => {
  const { posted } = await server(page);
  for (const address of ['/email/off', '/email/off#t=cut-short', `/email/off#token=${TOKEN}`]) {
    await page.goto(address);
    await expect(title(page)).toHaveText('This link doesn’t work');
    await expect(page.getByText('Open Peek and go to Settings › Delivery updates to change your emails.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Turn/ })).toHaveCount(0);
  }
  expect(posted).toEqual([]);
  // The way out leads to Peek's front door.
  await page.getByRole('link', { name: 'Open Peek' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Where’s my parcel?' })).toBeVisible();
});

test('says the same when the server does not take the token', async ({ page }) => {
  const { posted } = await server(page, [400]);
  await page.goto(LINK);
  await button(page, 'Turn off').click();
  await expect(title(page)).toHaveText('This link doesn’t work');
  await expect(page.getByRole('button', { name: /^Turn/ })).toHaveCount(0);
  expect(posted).toHaveLength(1);
});

test('says when it could not be changed, and the same button tries again', async ({ page }) => {
  const { posted } = await server(page, [503]);
  await page.goto(LINK);
  await button(page, 'Turn off').click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Couldn’t change it. Try again.');
  await expect(title(page)).toHaveText('Turn off delivery emails?');
  await button(page, 'Turn off').click();
  await expect(title(page)).toHaveText('Delivery emails are off');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  expect(posted).toHaveLength(2);
});
