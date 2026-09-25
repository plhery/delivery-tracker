import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import itMessages from '../shared/locales/it.json';
import { I18nProvider, LanguageControl, useI18n } from './i18n';

function Title() {
  const { t } = useI18n();
  return <p>{t('app.eyebrow')}</p>;
}

it('loads a chosen language on demand and keeps it selected meanwhile', async () => {
  const user = userEvent.setup();
  render(<I18nProvider><LanguageControl /><Title /></I18nProvider>);
  expect(screen.getByText('Parcel tracking')).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText('Language'), 'it');
  expect(screen.getByRole('combobox')).toHaveValue('it');
  expect(await screen.findByText(itMessages['app.eyebrow'])).toBeInTheDocument();
  expect(document.documentElement.lang).toBe('it');
});
