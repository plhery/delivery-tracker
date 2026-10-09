import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import de from '../../shared/locales/de.json';
import { I18nProvider, useI18n, type Locale } from '../i18n';
import { LANGUAGE_SETTLES_MS, useFollowLanguage } from './followLanguage';

function Probe({ follow }: { follow?: (locale: Locale) => Promise<void> }) {
  useFollowLanguage(follow);
  const { setLocale } = useI18n();
  return <>
    <button type="button" onClick={() => setLocale('en')}>English</button>
    <button type="button" onClick={() => setLocale('de')}>Deutsch</button>
  </>;
}

const open = (follow?: (locale: Locale) => Promise<void>) =>
  render(<I18nProvider initialLocale="de" initialMessages={de}><Probe follow={follow} /></I18nProvider>);
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const choose = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('following the app’s language', () => {
  it('hands it over once the page is live and has settled, then on every change', async () => {
    const follow = vi.fn(async () => undefined);
    open(follow);
    await wait(LANGUAGE_SETTLES_MS - 1);
    expect(follow).not.toHaveBeenCalled();
    await wait(1);
    expect(follow.mock.calls).toEqual([['de']]);

    choose('English');
    await wait(LANGUAGE_SETTLES_MS);
    expect(follow.mock.calls).toEqual([['de'], ['en']]);
  });

  it('hands over only the language a quick run of choices ends on', async () => {
    const follow = vi.fn(async () => undefined);
    open(follow);
    await wait(LANGUAGE_SETTLES_MS / 2);
    choose('English');
    await wait(LANGUAGE_SETTLES_MS / 2);
    choose('Deutsch');
    await wait(LANGUAGE_SETTLES_MS);
    expect(follow.mock.calls).toEqual([['de']]);
  });

  it('waits for the previous request, and skips a language replaced meanwhile', async () => {
    let finish!: () => void;
    const follow = vi.fn<(locale: Locale) => Promise<void>>(() => new Promise<void>((resolve) => { finish = resolve; }));
    open(follow);
    await wait(LANGUAGE_SETTLES_MS);
    choose('English');
    await wait(LANGUAGE_SETTLES_MS);
    choose('Deutsch');
    await wait(LANGUAGE_SETTLES_MS);
    // English waited behind the first request and was replaced before its turn.
    expect(follow.mock.calls).toEqual([['de']]);
    await act(async () => { finish(); });
    expect(follow.mock.calls).toEqual([['de'], ['de']]);
  });

  it('goes on after a failed request', async () => {
    const follow = vi.fn(async () => { throw new Error('offline'); });
    open(follow);
    await wait(LANGUAGE_SETTLES_MS);
    choose('English');
    await wait(LANGUAGE_SETTLES_MS);
    expect(follow.mock.calls).toEqual([['de'], ['en']]);
  });
});
