import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider, localizedEventDescription, useI18n, type Translate } from '../i18n';
import { userErrorMessage } from './userMessages';

const keyOnly = ((key: string) => key) as Translate;

it.each([
  [Object.assign(new Error('private diagnostics'), { status: 401 }), 'error.signIn'],
  [Object.assign(new Error('private diagnostics'), { status: 429 }), 'error.rateLimited'],
  [new Error('Token has expired or is invalid'), 'error.invalidCode'],
  [new Error('Email rate limit reached'), 'error.rateLimited'],
  [new Error('Failed to fetch'), 'error.connection'],
  [new Error('Delivery postcode required'), 'error.postcode'],
  [new Error('Parcel names can be at most 80 characters'), 'error.nameTooLong'],
  [new Error('Use a complete tracking link'), 'error.trackingLink'],
])('gives a useful localized next step for %s', (error, key) => {
  expect(userErrorMessage(error, keyOnly)).toBe(key);
});

describe('localized app messages', () => {
  function Probe() {
    const { t } = useI18n();
    return <><p>{userErrorMessage(new Error('SQL private failure'), t, 'add.failed')}</p>
      <p>{localizedEventDescription('Tracking added', t)}</p>
      <p>{localizedEventDescription('Original carrier scan', t)}</p></>;
  }
  it('translates app messages while preserving original carrier notes', async () => {
    localStorage.setItem('deliveryTrackerLocale', 'fr');
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(await screen.findByText('Ajouté à tes colis.')).toBeInTheDocument();
    expect(screen.queryByText(/SQL private failure/)).not.toBeInTheDocument();
    expect(screen.getByText('Original carrier scan')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn’t add/)).not.toBeInTheDocument();
  });
});
