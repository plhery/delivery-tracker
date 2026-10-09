import { afterEach, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => ({ cookie: undefined as string | undefined, acceptLanguage: null as string | null }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => name === 'sdt.locale' && request.cookie ? { name, value: request.cookie } : undefined }),
  headers: async () => new Headers(request.acceptLanguage ? { 'accept-language': request.acceptLanguage } : {}),
}));

const { languageFor, namedLocale, requestLanguage, requestLocale } = await import('./requestLocale');

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
  expect(polish.initialMessages?.['app.emptyTitle']).toBe((await import('../../shared/locales/pl.json')).default['app.emptyTitle']);
});

it('hands a page the messages of a language it names itself, whatever the request prefers', async () => {
  request.acceptLanguage = 'en-GB';
  request.cookie = 'fr';
  const german = languageFor('de');
  expect(german.initialLocale).toBe('de');
  expect(german.initialMessages?.['peek.title']).toBe('Wo ist mein Paket?');
  expect(languageFor('en')).toEqual({ initialLocale: 'en' });
});

it('speaks the language an address names, whatever the request prefers, and the request’s for one it does not know', async () => {
  request.acceptLanguage = 'de-CH,de;q=0.9';
  request.cookie = 'it';
  await expect(namedLocale('pl')).resolves.toBe('pl');
  for (const named of [undefined, '', 'xx', 'PL', ['pl', 'fr']]) {
    await expect(namedLocale(named)).resolves.toBe('it');
  }
});
