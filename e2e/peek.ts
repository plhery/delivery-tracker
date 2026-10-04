import { expect, type Page } from '@playwright/test';

// What the journeys through Peek's front door and parcel pages share.

/** A parcel's own address. */
const parcelAddress = /\/p\/[2-9A-HJ-NP-Za-km-z]{12}$/;

/**
 * Types a number at the front door and tracks it: the page ends on the
 * parcel's own address. `words` are the field's and the button's names in the
 * page's language.
 */
export async function track(page: Page, text: string, words: { field?: string; track?: string } = {}) {
  await page.goto('/');
  // The button is enabled once the page is live. On a phone's first visit "Paste and track"
  // stands over it until the field has text.
  const submit = page.getByRole('button', { name: words.track ?? 'Track', exact: true });
  await expect(submit).toBeEnabled();
  await page.getByRole('textbox', { name: words.field ?? 'Tracking number or link' }).fill(text);
  await submit.click();
  await expect(page).toHaveURL(parcelAddress);
}

/**
 * Lets a test read what the page copies. Chromium grants a test its
 * clipboard; WebKit has no such permission, so there the clipboard is stood in
 * for by one that keeps what the page hands it.
 */
export async function allowCopying(page: Page) {
  const context = page.context();
  if (context.browser()?.browserType().name() === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    return;
  }
  await page.addInitScript(() => {
    let kept = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { kept = text; },
      readText: async () => kept,
    } });
  });
}

/** What the page copied last. */
export const copied = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

/**
 * Nothing reaches past the screen's edge: neither the document nor a parcel's page lying over the door, which
 * scrolls on its own.
 */
export const fits = (page: Page) => page.evaluate(() => [document.documentElement, document.querySelector('.peekp-over')]
  .every((surface) => !surface || surface.scrollWidth <= surface.clientWidth));
