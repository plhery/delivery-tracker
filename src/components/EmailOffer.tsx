import { useId, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { trackAction } from '../lib/analytics';
import type { ApiAuth } from '../lib/apiClient';
import { saveEmailOnDelivery, useDeliveryEmail } from '../store/notificationPreferences';
import { Icon } from './Icon';

/**
 * Offered once, on a delivered parcel, to an account that has never chosen:
 * an email when the next one arrives. Either answer is saved, so the server
 * remembers it was asked and the offer does not come back.
 */
export function EmailOffer({ apiAuth, email }: {
  apiAuth: ApiAuth;
  /** The address the account signs in with. */
  email: string;
}) {
  const { t } = useI18n();
  const title = useId();
  const card = useRef<HTMLElement>(null);
  const delivery = useDeliveryEmail(apiAuth, email);
  // The answer given here, kept after it is saved: "Turn on" leaves a line in the card's place.
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save(on: boolean) {
    if (saving) return;
    const event = on ? 'email-offer-accept' : 'email-offer-decline';
    const page = card.current?.closest<HTMLElement>('[role="dialog"]');
    setAnswer(on);
    setSaving(true);
    setFailed(false);
    try {
      await saveEmailOnDelivery(on, apiAuth);
      trackAction(event, 'success');
      // The card went with the button that had the focus: it stays in the parcel's page.
      if (document.activeElement === document.body) page?.focus({ preventScroll: true });
    } catch {
      trackAction(event, 'error');
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  if (answer === true && delivery?.choice === true) {
    return <p className="email-offer__on" role="status">
      <Icon name="check" />{t('email.offer.on', { place: `${t('settings.title')} › ${t('settings.deliveryUpdates')}` })}
    </p>;
  }
  if (delivery?.choice !== null) return null;

  return <section ref={card} className="email-offer" aria-labelledby={title}>
    <span className="email-offer__icon" aria-hidden="true"><Icon name="mail" /></span>
    <div className="email-offer__text">
      <h2 id={title}>{t('email.offer.title')}</h2>
      <p>{t('email.offer.body', { email: delivery.address })}</p>
      {failed && <p className="email-offer__error" role="alert">{t('email.setting.failed')}</p>}
      <div className="email-offer__actions">
        <button type="button" className="button button--primary" disabled={saving} aria-busy={(saving && answer === true) || undefined} onClick={() => void save(true)}>{t('alerts.turnOn')}</button>
        <button type="button" className="email-offer__later" disabled={saving} aria-busy={(saving && answer === false) || undefined} onClick={() => void save(false)}>{t('onboarding.notifications.notNow')}</button>
      </div>
    </div>
  </section>;
}
