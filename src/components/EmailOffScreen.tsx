'use client';

import { useState, useSyncExternalStore } from 'react';
import { I18nProvider, LanguageControl, type Locale, type MessageKey, type Messages, useI18n } from '../i18n';
import { startAnalytics } from '../lib/analytics';
import { AppearanceProvider } from '../lib/appearance';
import { DeliveryEmailLinkError, deliveryEmailToken, switchDeliveryEmail } from '../lib/deliveryEmail';
import { useTabTitle } from '../lib/tabTitle';
import { PeekLockup } from './PeekMark';
import './EmailOff.css';

/** `ask` until a button is pressed; then what the server answered, or `invalid` for a link it does not take. */
type View = 'ask' | 'off' | 'on' | 'invalid';

const WORDS: Record<View, { title: MessageKey; body: MessageKey }> = {
  ask: { title: 'email.off.askTitle', body: 'email.off.askBody' },
  off: { title: 'email.off.title', body: 'email.off.body' },
  on: { title: 'email.off.onTitle', body: 'email.off.onBody' },
  invalid: { title: 'email.off.invalidTitle', body: 'email.off.invalidBody' },
};

function subscribeToAddress(notify: () => void) {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
}

/**
 * Where a delivery email's "turn it off" link leads. It needs no sign-in: the
 * link's token names the account. The page asks first and sends nothing until
 * its button is pressed, because mail scanners open the links of a message.
 */
export function EmailOffScreen({ initialLocale, initialMessages, emailLocale }: {
  initialLocale?: Locale;
  initialMessages?: Messages;
  /** The language of the email the link came from, which its address names: it wins over one this browser saved. */
  emailLocale?: Locale;
}) {
  return <I18nProvider initialLocale={initialLocale} initialMessages={initialMessages} addressLocale={emailLocale}>
    <AppearanceProvider><EmailOff /></AppearanceProvider>
  </I18nProvider>;
}

function EmailOff() {
  const { t } = useI18n();
  // The server never sees what follows the `#`, so the page reads it once it is live.
  const hash = useSyncExternalStore(subscribeToAddress, () => window.location.hash, () => null);
  const token = hash === null ? null : deliveryEmailToken(hash);
  // What the server answered, and for which token.
  const [answer, setAnswer] = useState<{ token: string; view: Exclude<View, 'ask'> } | null>(null);
  // The state a pressed button asked for, until the server answers.
  const [asking, setAsking] = useState<'off' | 'on' | null>(null);
  const [failed, setFailed] = useState(false);
  const view: View = hash !== null && !token ? 'invalid' : answer && answer.token === token ? answer.view : 'ask';
  const { title, body } = WORDS[view];

  useTabTitle(`${t('app.title')} — ${t(title)}`);

  async function change(next: 'off' | 'on') {
    if (!token || asking) return;
    // Only someone who presses the button is counted: opening the page says nothing.
    void startAnalytics();
    setAsking(next);
    setFailed(false);
    try {
      setAnswer({ token, view: await switchDeliveryEmail(token, next === 'on') ? 'on' : 'off' });
    } catch (error) {
      if (error instanceof DeliveryEmailLinkError) setAnswer({ token, view: 'invalid' });
      else setFailed(true);
    } finally {
      setAsking(null);
    }
  }

  // One button, whatever it says: the focus stays on it from the question to the way back.
  const next = view === 'off' ? 'on' : 'off';
  return <main className="auth-screen email-off">
    <div className="feedback-language"><LanguageControl /></div>
    <section className="auth-card" aria-labelledby="email-off-title">
      <p className="auth-card__eyebrow"><PeekLockup /></p>
      <div aria-live="polite">
        <h1 id="email-off-title">{t(title)}</h1>
        <p className="auth-card__intro">{t(body, { place: `${t('settings.title')} › ${t('settings.deliveryUpdates')}` })}</p>
      </div>
      {failed && <p className="sheet__error" role="alert">{t('email.off.failed')}</p>}
      {view !== 'invalid' && <button
        type="button"
        className={`button ${view === 'ask' ? 'button--primary' : 'button--secondary'}`}
        disabled={hash === null}
        aria-disabled={asking !== null || undefined}
        aria-busy={asking !== null || undefined}
        onClick={() => void change(next)}
      >
        {t(next === 'on' ? 'email.off.undo' : asking === 'off' ? 'email.off.working' : 'email.off.turnOff')}
      </button>}
      {/* The deliveries are another document, with a sign-in of their own. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a className={view === 'invalid' ? 'button button--primary' : 'email-off__open'} href="/">{t('email.off.open')}</a>
    </section>
  </main>;
}
