import en from '../shared/locales/en.json';
import { StrictMode } from 'react';
import de from '../shared/locales/de.json';
import fr from '../shared/locales/fr.json';
import itMessages from '../shared/locales/it.json';
import trackingMessages from '../shared/tracking-messages.json';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  detectLocale,
  I18nProvider,
  LanguageControl,
  localizedExpectedDelivery,
  localizedDeliveryDate,
  localizedDatePhrase,
  localizedRelativeTime,
  stageLabel,
  type Translate,
  useI18n,
  translate,
  localizedEventDescription,
  localizedDeliveryWindow,
  trackingFailureMessage,
  SUPPORTED_LOCALES,
  type MessageKey,
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
  it('restores the saved language before persisting during StrictMode effect replay', async () => {
    window.localStorage.setItem('deliveryTrackerLocale', 'fr');
    render(<StrictMode><I18nProvider><TranslationProbe /></I18nProvider></StrictMode>);
    await screen.findByText('Suivi de colis');
    expect(window.localStorage.getItem('deliveryTrackerLocale')).toBe('fr');
  });
  it('translates every shared tracking message in every locale and preserves original scan notes', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const t: Translate = (key, variables) => translate(locale, key, variables);
      for (const [description, message] of Object.entries(trackingMessages.events)) {
        expect(localizedEventDescription(description, t)).toBe(t(message.key as MessageKey, message.variables));
        expect(localizedEventDescription(description, t)).not.toMatch(/\{\{/);
      }
      for (const kind of Object.keys(trackingMessages.failures)) expect(trackingFailureMessage(`carrier:${kind}`, t)).toBeTruthy();
      expect(localizedEventDescription('Scanned by Sophie at dock 12', t)).toBe('Scanned by Sophie at dock 12');
      expect(localizedEventDescription('toString', t)).toBe('toString');
      expect(trackingFailureMessage('HTTP 403 internal diagnostic', t)).toBe(t('detail.trackingUnavailable'));
      expect(trackingFailureMessage('carrier:new_kind', t)).toBe(t('detail.trackingUnavailable'));
    }
    expect(localizedEventDescription('Shipment exception', key => translate('fr', key))).toBe('Problème avec le colis');
  });

  it('shows delivery windows and ignores missing, reversed or invalid starts', () => {
    const now = new Date(2026, 8, 9, 12).getTime();
    const t: Translate = (key, variables) => translate('en', key, variables);
    expect(localizedDeliveryWindow('2026-09-10', '2026-09-11', t, 'en-CH', now)).toBe('tomorrow – Fri 11 sep');
    for (const from of [undefined, 'invalid', '2026-09-12', '2026-09-11']) {
      expect(localizedDeliveryWindow(from, '2026-09-11', t, 'en-CH', now)).toBe('Fri 11 sep');
    }
  });
  it('detects all supported Swiss languages and falls back to English', () => {
    expect(detectLocale(['de-CH'])).toBe('de');
    expect(detectLocale(['rm-CH', 'it-CH'])).toBe('it');
    expect(detectLocale(['es-ES'])).toBe('es');
    expect(detectLocale(['pt-PT'])).toBe('pt');
    expect(detectLocale(['pl-PL'])).toBe('pl');
    expect(detectLocale(['nl-NL'])).toBe('en');
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
    ['es', ['ayer', 'hoy', 'mañana'], '1 sello', '2 sellos'],
    ['pt', ['ontem', 'hoje', 'amanhã'], '1 selo', '2 selos'],
    ['pl', ['wczoraj', 'dziś', 'jutro'], '1 znaczek', '2 znaczki'],
  ] as const)('supports dates and counts in %s', (locale, days, one, two) => {
    const t: Translate = (key, variables) => translate(locale, key, variables);
    const now = new Date(2026, 8, 9, 12).getTime();
    for (const [index, day] of [8, 9, 10].entries()) {
      const date = localizedDeliveryDate(new Date(2026, 8, day), t, locale, now);
      expect(date).toBe(days[index]);
      expect(localizedDatePhrase(date, t)).toBe(date);
    }
    expect(t('friends.stampCount', { count: 1 })).toBe(one);
    expect(t('friends.stampCount', { count: 2 })).toBe(two);
  });

  it.each([0, 1, 2, 4, 5, 12, 14, 21, 22, 25, 101, 102, 112])('declines Polish quantities for %i', (count) => {
    const few = [2, 4, 22, 102].includes(count);
    expect(translate('pl', 'friends.stampCount', { count }))
      .toBe(`${count} ${count === 1 ? 'znaczek' : few ? 'znaczki' : 'znaczków'}`);
    expect(translate('pl', count === 1 ? 'detail.updateCount.one' : 'detail.updateCount.many', { count }))
      .toBe(`${count} ${count === 1 ? 'aktualizacja' : few ? 'aktualizacje' : 'aktualizacji'}`);
    expect(translate('pl', count === 1 ? 'passport.parcels.one' : 'passport.parcels.many', { count }))
      .toBe(`${count} ${count === 1 ? 'przesyłka' : few ? 'przesyłki' : 'przesyłek'}`);
  });

  it.each(['en', 'de', 'fr', 'it'] as const)('uses natural date phrases and singular counts in %s', (locale) => {
    const t: Translate = (key, variables) => translate(locale, key, variables);
    for (const key of ['time.yesterday', 'time.today', 'time.tomorrow'] as const) {
      expect(localizedDatePhrase(t(key), t)).toBe(t(key));
      expect(t('parcel.ariaExpected', { name: 'Parcel', status: 'In transit', date: t(key) }))
        .toContain(`: ${t(key)}`);
    }
    expect(localizedDatePhrase('12/09/2026', t)).toBe(t('parcel.onDate', { date: '12/09/2026' }));
    const singularStamps = { en: '1 stamp', fr: '1 timbre', de: '1 Briefmarke', it: '1 francobollo' };
    const pluralStamps = { en: 'stamps', fr: 'timbres', de: 'Briefmarken', it: 'francobolli' };
    expect(t('friends.stampCount', { count: 1 })).toBe(singularStamps[locale]);
    for (const count of [0, 2, 10]) {
      expect(t('friends.stampCount', { count })).toBe(`${count} ${pluralStamps[locale]}`);
    }
    const singleLink = { en: 'Cancel 1 previous link', fr: 'Annuler 1 lien précédent', de: '1 früheren Link widerrufen', it: 'Annulla 1 link precedente' };
    expect(t('friends.cancelPrevious', { count: 1 })).toBe(singleLink[locale]);
    const singleDelivered = { en: 'Delivered', fr: 'Livré', de: 'Zugestellt', it: 'Consegnato' };
    expect(t('passport.delivered', { count: 1 })).toBe(singleDelivered[locale]);
    expect(t('friends.day', { count: 1 })).toBe(t('friends.day'));
  });

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
