import { expect, test, type Locator } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('sdt.web.experience.v1', 'demo');
    localStorage.setItem('deliveryTrackerLocale', 'en');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});

test('engraves the route in the card and opens it as a full map', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: /^(?:Next up: )?New trainers 👟 —/ }).click();
  const detail = page.locator('.detail--postcard');
  const engraving = detail.locator('.detail__engraving [data-scale]');
  // Out for delivery: the card shows the last mile, with Hamburg on the edge.
  await expect(engraving).toHaveAttribute('data-mode', 'now');
  await expect(detail.locator('.detail__engraving').getByText('Hamburg', { exact: true })).toBeVisible();

  const open = detail.getByRole('button', { name: 'Open the map' });
  await open.click();
  const map = page.getByRole('dialog', { name: 'Map of the journey from Hamburg to Zürich' });
  await expect(map).toBeVisible();
  await expect(map.getByText('From', { exact: true })).toBeVisible();
  await expect(map.getByRole('button', { name: 'Nearby' })).toHaveAttribute('aria-pressed', 'true');
  await map.getByRole('button', { name: 'Journey' }).click();
  await expect(map.locator('[data-scale]')).toHaveAttribute('data-mode', 'journey');
  const bar = (await map.locator('.parcel-map__bar').boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(bar.x + bar.width).toBeLessThanOrEqual(viewport.width);
  expect(bar.y + bar.height).toBeLessThanOrEqual(viewport.height);

  await page.keyboard.press('Escape');
  await expect(map).toHaveCount(0);
  await expect(detail).toBeVisible();
  await expect(open).toBeFocused();
  expect(errors).toEqual([]);
});

test('keeps Pip on the opened map, and shows more of the land up close', async ({ page, isMobile }) => {
  const tiles: { address: string; kept: string }[] = [];
  page.on('response', (response) => {
    const address = new URL(response.url());
    if (address.pathname.startsWith('/atlas/')) tiles.push({ address: address.pathname + address.search, kept: response.headers()['cache-control'] ?? '' });
  });
  await page.getByRole('button', { name: /^(?:Next up: )?New trainers 👟 —/ }).click();
  await page.locator('.detail--postcard').getByRole('button', { name: 'Open the map' }).click();
  const map = page.getByRole('dialog', { name: 'Map of the journey from Hamburg to Zürich' });
  // Waiting at its pickup point, Pip waits here as he does on the card: beside the dot, clear of the summary.
  const pip = map.locator('[data-pip="wait"]');
  await expect(pip).toBeVisible();
  await pip.locator('> span').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const box = (await pip.locator('svg > g > g').boundingBox())!;
  const dot = (await map.locator('g[data-kind="current"] circle').last().boundingBox())!;
  const bar = (await map.locator('.parcel-map__bar').boundingBox())!;
  expect(Math.hypot(box.x + box.width / 2 - dot.x, box.y + box.height / 2 - dot.y)).toBeLessThan(90);
  expect(box.x + box.width <= bar.x || box.x >= bar.x + bar.width || box.y + box.height <= bar.y).toBe(true);

  // The last mile is a close-up: the site's own tiles around Zürich draw its rivers, roads and towns.
  await expect.poll(() => tiles.length).toBeGreaterThan(0);
  expect(tiles.every((tile) => /^\/atlas\/\d+_\d+\.bin\?v=[0-9a-f]{12}$/.test(tile.address))).toBe(true);
  // A tile never changes under its address, so a browser keeps it.
  if (process.env.CI || process.env.PLAYWRIGHT_PRODUCTION) expect(tiles.every((tile) => tile.kept.includes('immutable'))).toBe(true);
  // A wide screen has room for the towns around.
  if (!isMobile) await expect(map.getByText('Winterthur', { exact: true })).toBeVisible();

  // He keeps his spot while the map is moved under him.
  const view = (await map.locator('[data-scale]').boundingBox())!;
  const beside = async () => {
    const [pipBox, dotBox] = [await pip.boundingBox(), await map.locator('g[data-kind="current"] circle').last().boundingBox()];
    return [pipBox!.x - dotBox!.x, pipBox!.y - dotBox!.y];
  };
  const spot = await beside();
  await page.mouse.move(view.x + view.width * .6, view.y + view.height * .2);
  await page.mouse.down();
  await page.mouse.move(view.x + view.width * .6 - 40, view.y + view.height * .2 + 30, { steps: 8 });
  await page.mouse.up();
  await expect(map.getByRole('button', { name: 'Nearby' })).toHaveAttribute('aria-pressed', 'false');
  const kept = await beside();
  expect(Math.hypot(kept[0] - spot[0], kept[1] - spot[1])).toBeLessThan(1);

  // The whole journey is too wide for towns, and Pip comes along.
  await map.getByRole('button', { name: 'Journey' }).click();
  await expect(map.locator('[data-scale]')).toHaveAttribute('data-mode', 'journey');
  await expect(pip).toBeVisible();
  await expect(map.getByText('Winterthur', { exact: true })).toHaveCount(0);
});

test('draws the route as one stroke, leg after leg', async ({ page }) => {
  await page.getByRole('button', { name: /^Belgian chocolate 🍫 —/ }).click();
  const legs = page.locator('.detail--postcard .detail__engraving path[data-kind="travelled"]');
  await expect(legs).toHaveCount(2);
  // How much of each leg is left to draw with the stroke held at a share of its time: 1 is all of it, 0 none.
  const left = (share: number) => legs.evaluateAll((paths, share) => {
    const [stroke] = paths[0].parentElement!.getAnimations();
    stroke.pause();
    stroke.currentTime = Number(stroke.effect!.getComputedTiming().duration) * share;
    return paths.map((path) => Number.parseFloat(getComputedStyle(path).strokeDashoffset));
  }, share);
  // Out for delivery, the card shows the last mile: the stroke starts where the leg from Brussels comes into the picture.
  const [start, waiting] = await left(0);
  expect(start).toBeGreaterThan(.5);
  expect(start).toBeLessThan(1);
  expect(waiting).toBe(1);
  // That leg is drawn first, and Basel to Zürich waits for it.
  const [first, second] = await left(.4);
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThan(start);
  expect(second).toBe(1);
  expect(await left(1)).toEqual([0, 0]);
});

test('draws the route on Next up, and opens the parcel on the same picture', async ({ page }) => {
  // How far below the top of its card the parcel's dot sits.
  const dotOffset = async (card: Locator) => {
    // The dot itself, not the halo that pulses around it.
    const dot = await card.locator('g[data-kind="current"] circle').last().boundingBox();
    const box = await card.boundingBox();
    return dot && box ? dot.y - box.y : NaN;
  };
  const next = page.locator('.parcel-card--hero');
  const engraving = next.locator('.parcel-card__engraving');
  // Waiting at its pickup point: the card shows the last mile, with Hamburg on the edge.
  await expect(engraving.locator('[data-scale]')).toHaveAttribute('data-mode', 'now');
  await expect(engraving.getByText('Hamburg', { exact: true })).toBeVisible();
  // Only Next up draws its route across the card.
  await expect(page.locator('.parcel-card__engraving')).toHaveCount(1);
  const inList = await dotOffset(next);

  // Every other card with a located scan carries its whole journey small, in quiet marks that do not pulse.
  const routes = page.locator('.parcel-card--route');
  await expect(routes.first().locator('.card-route [data-quiet]')).toHaveAttribute('data-mode', 'journey');
  await expect(routes.first().locator('g[data-kind="current"] circle')).toHaveCount(1);
  expect(await routes.count()).toBeGreaterThan(3);
  // The words keep clear of the route: a card's name ends before its first mark.
  for (const card of (await routes.all()).slice(0, 4)) {
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('.card-route g[data-kind] circle').first()).toBeVisible();
    const name = (await card.locator('.parcel-card__label').boundingBox())!;
    const marks = await card.locator('.card-route g[data-kind] circle').evaluateAll((circles) => circles.map((circle) => circle.getBoundingClientRect().left));
    expect(name.x + name.width).toBeLessThanOrEqual(Math.min(...marks));
  }
  // A parcel with no located scan keeps its plain card.
  await expect(page.getByRole('button', { name: /^35mm film rolls/ }).locator('.card-route')).toHaveCount(0);
  await next.scrollIntoViewIfNeeded();

  // The drawing takes no touches: a tap on it opens the parcel like the rest of the card.
  await next.click({ position: { x: 60, y: 70 } });
  const hero = page.locator('.detail--postcard .detail__hero');
  await expect(hero.locator('.detail__engraving [data-scale]')).toHaveAttribute('data-mode', 'now');
  await expect.poll(async () => Math.abs(await dotOffset(hero) - inList)).toBeLessThan(1.5);
});

test('stands Pip beside the parcel\u2019s dot, in the mood of its stage', async ({ page, isMobile }) => {
  // The dot and the box Pip is drawn as, inside one card's map.
  const marks = async (card: Locator) => {
    await expect(card.locator('[data-pip]')).toBeVisible();
    // He rises into place first.
    await card.locator('[data-pip] > span').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    const dot = (await card.locator('g[data-kind="current"] circle').last().boundingBox())!;
    // His flaps are drawn on their hinges, where a box around each would be a loose fit: he is measured by his corners.
    const pip = await card.locator('[data-pip] svg > g > g').evaluate((body) => {
      const corners = [...body.querySelectorAll<SVGGraphicsElement>(':scope > path, polygon')].flatMap((shape) => {
        const { x, y, width, height } = shape.getBBox();
        const own = shape instanceof SVGPolygonElement ? [...shape.points] : [{ x, y }, { x: x + width, y }, { x, y: y + height }, { x: x + width, y: y + height }];
        return own.map((corner) => new DOMPoint(corner.x, corner.y).matrixTransform(shape.getScreenCTM()!));
      });
      const [left, top] = [Math.min(...corners.map((corner) => corner.x)), Math.min(...corners.map((corner) => corner.y))];
      return { x: left, y: top, width: Math.max(...corners.map((corner) => corner.x)) - left, height: Math.max(...corners.map((corner) => corner.y)) - top };
    });
    const map = (await card.locator('[data-scale]').boundingBox())!;
    return { dot, pip, map };
  };
  const apart = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

  // Waiting at its pickup point, Pip waits too: on Next up, then on the same spot of the parcel's page.
  const next = page.locator('.parcel-card--hero');
  await expect(next.locator('[data-pip]')).toHaveAttribute('data-pip', 'wait');
  await expect(next.locator('[data-pip]')).toHaveAttribute('aria-hidden', 'true');
  const inList = await marks(next);
  expect(apart(inList.dot, inList.pip)).toBe(true);
  expect(inList.pip.x).toBeGreaterThanOrEqual(inList.map.x);
  expect(inList.pip.x + inList.pip.width).toBeLessThanOrEqual(inList.map.x + inList.map.width);
  // The parcel is still on its way, so its dot pulses.
  await expect(next.locator('g[data-kind="current"] circle')).toHaveCount(2);
  await next.click({ position: { x: 60, y: 70 } });
  const hero = page.locator('.detail--postcard .detail__hero');
  expect(apart((await marks(hero)).dot, (await marks(hero)).pip)).toBe(true);
  // On a phone the card and the page are as wide as each other, so he stands on the same spot once he has risen into place.
  if (isMobile) await expect.poll(async () => {
    const onPage = await marks(hero);
    return Math.max(Math.abs((onPage.pip.x - onPage.dot.x) - (inList.pip.x - inList.dot.x)), Math.abs((onPage.pip.y - onPage.dot.y) - (inList.pip.y - inList.dot.y)));
  }).toBeLessThan(1.5);
  await page.keyboard.press('Escape');

  // Out for delivery he bobs, eager to arrive.
  await page.getByRole('button', { name: /^Belgian chocolate 🍫 —/ }).click();
  const eager = hero.locator('[data-pip="eager"] svg > g > g');
  await expect(eager).toHaveCSS('animation-iteration-count', 'infinite');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(eager).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.keyboard.press('Escape');

  // Delivered, the box is open and the dot is still.
  await page.getByRole('button', { name: /^Coffee beans ☕ —/ }).click();
  await expect(hero.locator('[data-pip="joy"] polygon')).toHaveCount(4);
  await expect(hero.locator('g[data-kind="current"] circle')).toHaveCount(1);
  expect(apart((await marks(hero)).dot, (await marks(hero)).pip)).toBe(true);
});

test('zooms the full map with the wheel, and returns to the parcel', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Wheels and trackpads are for desktops.');
  await page.getByRole('button', { name: /^(?:Next up: )?New trainers 👟 —/ }).click();
  await page.locator('.detail--postcard').getByRole('button', { name: 'Open the map' }).click();
  const map = page.getByRole('dialog', { name: /^Map of the journey/ });
  const nearby = map.getByRole('button', { name: 'Nearby' });
  await expect(nearby).toHaveAttribute('aria-pressed', 'true');
  const box = (await map.locator('[data-scale]').boundingBox())!;
  await page.mouse.move(box.x + box.width * .6, box.y + box.height / 3);
  await page.mouse.wheel(0, -400);
  await expect(nearby).toHaveAttribute('aria-pressed', 'false');
  await nearby.click();
  await expect(nearby).toHaveAttribute('aria-pressed', 'true');
});

for (const [parcel, place] of [['Trail weekend kit', 'Buchs'], ['Coffee beans', 'Zürich']]) {
  test(`offers no other view when every place is close by: ${parcel}`, async ({ page }) => {
    await page.getByRole('button', { name: new RegExp(`^(?:Next up: )?${parcel}`) }).click();
    await page.locator('.detail--postcard').getByRole('button', { name: 'Open the map' }).click();
    const map = page.getByRole('dialog', { name: `Map showing ${place}` });
    const dot = map.locator('g[data-kind="current"]');
    await expect(dot).toBeAttached();
    const resting = await dot.getAttribute('transform');
    const box = (await map.locator('[data-scale]').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 3 + 40, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => dot.getAttribute('transform')).not.toBe(resting);
    // Not even once the map is moved: both views would show the same places.
    await expect(map.getByRole('group', { name: 'Map view' })).toHaveCount(0);
  });
}

test('pinches the full map, and lets the card peek closer', async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile || browserName !== 'chromium', 'Two-finger touches go through Chromium’s DevTools protocol.');
  const client = await page.context().newCDPSession(page);
  const pinch = async (x: number, y: number, from: number, to: number, lift = true) => {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - from, y, id: 1 }, { x: x + from, y, id: 2 }] });
    for (let step = 1; step <= 6; step += 1) {
      const spread = from + (to - from) * step / 6;
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - spread, y, id: 1 }, { x: x + spread, y, id: 2 }] });
    }
    if (lift) await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await page.getByRole('button', { name: /^(?:Next up: )?New trainers 👟 —/ }).click();
  const detail = page.locator('.detail--postcard');
  const engraving = detail.locator('.detail__engraving');
  const leg = engraving.locator('path[data-kind="travelled"]').first();
  await expect(leg).toBeAttached();
  const resting = await leg.getAttribute('d');
  const card = (await engraving.boundingBox())!;
  await pinch(card.x + card.width / 2, card.y + card.height / 2, 30, 90, false);
  await expect.poll(() => leg.getAttribute('d')).not.toBe(resting);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // Lifting the fingers settles the card back without opening the map.
  await expect.poll(() => leg.getAttribute('d')).toBe(resting);
  await expect(page.getByRole('dialog', { name: /^Map of the journey/ })).toHaveCount(0);

  await detail.getByRole('button', { name: 'Open the map' }).click();
  const map = page.getByRole('dialog', { name: /^Map of the journey/ });
  const nearby = map.getByRole('button', { name: 'Nearby' });
  await expect(nearby).toHaveAttribute('aria-pressed', 'true');
  const box = (await map.locator('[data-scale]').boundingBox())!;
  await pinch(box.x + box.width / 2, box.y + box.height / 3, 80, 20);
  await expect(nearby).toHaveAttribute('aria-pressed', 'false');
  await expect(map).toBeVisible();
});

test('keeps the card plain for a parcel with no places yet', async ({ page }) => {
  await page.getByRole('button', { name: /^(?:Next up: )?35mm film rolls 🎞️ —/ }).click();
  const detail = page.locator('.detail--postcard');
  await expect(detail.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(detail.locator('.detail__engraving')).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Open the map' })).toHaveCount(0);
});

test('keeps the card\u2019s map clear of a second carrier\u2019s mark', async ({ page, isMobile }) => {
  // The same journey twice: handed from one carrier to another, and with one carrier. Its first name would stand where the second mark is.
  await page.addInitScript(() => {
    const at = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
    const stops = [['Amsterdam', 'NL', 52.37, 4.9], ['Köln', 'DE', 50.94, 6.96], ['Basel', 'CH', 47.56, 7.59], ['Bern', 'CH', 46.95, 7.45]] as const;
    const parcel = (id: string, label: string, handover: object) => ({
      id, label, carrier: 'gls-de', trackingNumber: '12345678901', createdAt: at(80), syncStatus: 'idle', lastSyncedAt: at(1), ...handover,
      events: stops.map(([name, country, latitude, longitude], index) => ({
        id: `${id}-${index}`, parcelId: id, stage: index ? 'in_transit' : 'accepted', occurredAt: at((stops.length - index) * 12),
        description: 'Scan', location: name, place: { name, country, latitude, longitude, precision: 'city' },
      })),
    });
    localStorage.setItem('sdt.demo.parcels.v1', JSON.stringify([
      parcel('handed', 'Ceramic lamp', { originalCarrier: 'gls-de', originalTrackingNumber: '12345678901', trackingSource: 'swiss-post', activeTrackingNumber: '993412345612345678' }),
      parcel('plain', 'Desk lamp', {}),
    ]));
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const detail = page.locator('.detail--postcard');
  const hero = detail.locator('.detail__hero');
  const name = detail.locator('.detail__engraving').getByText('Amsterdam', { exact: true });
  /** Where a part of the card stands, from the card's own corner. */
  const within = async (part: Locator) => {
    const [box, card] = [(await part.boundingBox())!, (await hero.boundingBox())!];
    return { x: box.x - card.x, y: box.y - card.y, width: box.width, height: box.height };
  };
  const apart = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

  /** The card has opened and its map has landed: nothing moves on the screen any more. */
  const settled = async () => {
    await expect(name).toBeVisible();
    let last = '';
    await expect.poll(async () => {
      const now = JSON.stringify([await hero.boundingBox(), await name.boundingBox()]);
      const still = now === last;
      last = now;
      return still;
    }).toBe(true);
  };

  await page.getByRole('button', { name: /^(?:Next up: )?Desk lamp —/ }).click();
  await settled();
  const plain = {
    mark: await within(detail.locator('.detail__carrier .carrier-mark')), title: await within(detail.locator('.detail__title-row')),
    height: (await hero.boundingBox())!.height, map: await within(detail.locator('.detail__engraving')), name: await within(name),
  };
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);

  await page.getByRole('button', { name: /^(?:Next up: )?Ceramic lamp —/ }).click();
  const marks = detail.getByRole('button', { name: 'Change carrier from GLS Germany. Delivery with Swiss Post' }).locator('.carrier-mark');
  await expect(marks).toHaveCount(2);
  await settled();
  // The first mark stands where it does on any card; the second mark is under the first.
  const [first, second] = [await within(marks.first()), await within(marks.last())];
  expect(Math.abs(first.x - plain.mark.x) + Math.abs(first.y - plain.mark.y)).toBeLessThan(.5);
  expect(second.x).toBeCloseTo(first.x, 0);
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  // The map is two lines taller, and the name two lines lower: the route starts below the marks, as large as on any card.
  expect((await within(detail.locator('.detail__engraving'))).height - plain.map.height).toBeCloseTo(40, 0);
  expect((await within(detail.locator('.detail__title-row'))).y - plain.title.y).toBeCloseTo(40, 0);
  // One more line, for the words that say who delivers.
  await expect(hero.getByText('Delivery with Swiss Post')).toBeVisible();
  expect((await hero.boundingBox())!.height - plain.height).toBeLessThan(40 + 32);
  // On a phone the first name stood where the second mark now is: the route has moved down with the room, name and all.
  if (isMobile) expect(apart(plain.name, second)).toBe(false);
  expect(apart(await within(name), second)).toBe(true);
  expect(Math.abs((await within(name)).y - plain.name.y - 40)).toBeLessThan(1);
  const pip = hero.locator('[data-pip]');
  await expect(pip).toBeVisible();
  for (const dot of await hero.locator('.detail__engraving g[data-kind] circle').all()) expect(apart(await within(dot), second)).toBe(true);
  // Each carrier's website stands under its own number, below the card.
  await expect(detail.getByRole('link', { name: /^Open the .+ website$/ })).toHaveCount(2);
  await expect(hero.getByRole('link')).toHaveCount(0);
});
