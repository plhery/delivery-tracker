import en from '../shared/locales/en.json';
import de from '../shared/locales/de.json';
import fr from '../shared/locales/fr.json';
import itMessages from '../shared/locales/it.json';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  detectLocale,
  I18nProvider,
  LanguageControl,
  localizedExpectedDelivery,
  localizedDeliveryDate,
  localizedRelativeTime,
  stageLabel,
  type Translate,
  useI18n,
} from './i18n';

function TranslationProbe() {
  const { t } = useI18n();
  return (
    <>
      <p>{t('app.eyebrow')}</p>
      <p>{stageLabel(t, 'out_for_delivery')}</p>
    </>
  );
}

describe('localization', () => {
  it('detects all supported Swiss languages and falls back to English', () => {
    expect(detectLocale(['de-CH'])).toBe('de');
    expect(detectLocale(['rm-CH', 'it-CH'])).toBe('it');
    expect(detectLocale(['es-ES'])).toBe('en');
  });

  it('persists an explicit language and updates the document language', async () => {
    window.localStorage.setItem('deliveryTrackerLocale', 'de');
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <LanguageControl />
        <TranslationProbe />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Sprache')).toHaveValue('de');
      expect(screen.getByText('Sendungsverfolgung')).toBeInTheDocument();
      expect(screen.getByText('In Zustellung')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText('Sprache'), 'fr');
    expect(screen.getByText('Suivi de colis')).toBeInTheDocument();
    expect(screen.getByText('En livraison')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('fr');
      expect(window.localStorage.getItem('deliveryTrackerLocale')).toBe('fr');
    });
  });

  it('preserves precise carrier estimates in the recipient timezone', () => {
    const t = ((key: string) => key) as Translate;
    const timestamp = new Date('2026-09-07T12:30:00Z');
    const time = new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(timestamp);
    expect(localizedExpectedDelivery(timestamp.toISOString(), t, 'fr-CH', timestamp.getTime()))
      .toBe(`time.today, ${time}`);
  });

  it('formats calendar dates with the selected language tag', () => {
    const t = ((key: string) => key) as Translate;
    const now = new Date(2026, 0, 1, 12).getTime();
    const update = new Date(2025, 11, 20, 12);

    expect(localizedExpectedDelivery('2026-12-31', t, 'en-CH', now)).toBe(
      'Thu 31 dec',
    );
    expect(localizedRelativeTime(update.toISOString(), t, 'it-CH', now)).toBe(
      'Sab 20 dic',
    );
  });
});

describe('relative delivery dates', () => {
  it.each([
    ['en-CH', en, ['yesterday', 'today', 'tomorrow']],
    ['de-CH', de, ['gestern', 'heute', 'morgen']],
    ['fr-CH', fr, ['hier', 'aujourd’hui', 'demain']],
    ['it-CH', itMessages, ['ieri', 'oggi', 'domani']],
  ] as const)('localizes nearby dates and preserves delivery times in %s', (locale, messages, labels) => {
    const t: Translate = (key) => messages[key];
    const now = new Date(2026, 8, 9, 12).getTime();
    for (const [index, day] of [8, 9, 10].entries()) {
      const value = `2026-09-${String(day).padStart(2, '0')}`;
      expect(localizedExpectedDelivery(value, t, locale, now)).toBe(labels[index]);
      expect(localizedExpectedDelivery(`${value} 14:00-16:00`, t, locale, now)).toBe(`${labels[index]}, 14:00–16:00`);
      expect(localizedExpectedDelivery(new Date(2026, 8, day, 14, 5).toISOString(), t, locale, now)).toBe(`${labels[index]}, 14:05`);
    }
    expect(localizedExpectedDelivery('Awaiting estimate', t, locale, now)).toBe('Awaiting estimate');
  });

  it.each([
    [new Date(2026, 0, 1, 0, 5), new Date(2025, 11, 31, 23, 55), 'yesterday'],
    [new Date(2026, 11, 31, 23, 55), new Date(2027, 0, 1, 0, 5), 'tomorrow'],
    [new Date(2026, 2, 30, 0, 5), new Date(2026, 2, 29, 0, 5), 'yesterday'],
    [new Date(2026, 9, 25, 0, 5), new Date(2026, 9, 26, 0, 5), 'tomorrow'],
    [new Date(2026, 8, 9, 23, 55), new Date(2026, 8, 9, 0, 5), 'today'],
    [new Date(2026, 8, 9, 23, 55), new Date(2026, 8, 11, 0, 5), 'Fri 11 sep'],
  ])('uses calendar days from %s to %s', (now, date, expected) => {
    expect(localizedDeliveryDate(date, (key) => en[key], 'en-CH', now.getTime())).toBe(expected);
  });
});
