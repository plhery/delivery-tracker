import { afterEach, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => ({ cookie: undefined as string | undefined, acceptLanguage: null as string | null }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => name === 'sdt.locale' && request.cookie ? { name, value: request.cookie } : undefined }),
  headers: async () => new Headers(request.acceptLanguage ? { 'accept-language': request.acceptLanguage } : {}),
}));

const { requestLanguage, requestLocale } = await import('./requestLocale');

afterEach(() => {
  request.cookie = undefined;
  request.acceptLanguage = null;
});

it('renders the language the browser prefers', async () => {
  request.acceptLanguage = 'fr-CH,fr;q=0.9,en;q=0.8';
  await expect(requestLocale()).resolves.toBe('fr');

  request.acceptLanguage = 'nl-NL,de;q=0.7';
  await expect(requestLocale()).resolves.toBe('de');

  request.acceptLanguage = 'ja-JP';
  await expect(requestLocale()).resolves.toBe('en');
});

it('prefers a language chosen in the app', async () => {
  request.acceptLanguage = 'de-CH,de;q=0.9';
  request.cookie = 'it';
  await expect(requestLocale()).resolves.toBe('it');

  request.cookie = 'xx';
  await expect(requestLocale()).resolves.toBe('de');
});

it('falls back to English without language headers', async () => {
  await expect(requestLocale()).resolves.toBe('en');
});

it('sends messages only for languages the client does not ship', async () => {
  request.acceptLanguage = 'en-GB';
  await expect(requestLanguage()).resolves.toEqual({ initialLocale: 'en' });

  request.acceptLanguage = 'pl-PL';
  const polish = await requestLanguage();
  expect(polish.initialLocale).toBe('pl');
  expect(polish.initialMessages?.['app.eyebrow']).toBe((await import('../../shared/locales/pl.json')).default['app.eyebrow']);
});
