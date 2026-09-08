'use client';

import { AppearanceProvider } from '../lib/appearance';
import { I18nProvider, LanguageControl, type MessageKey, useI18n } from '../i18n';
import { ParcelIllustration } from './Icon';

type FeedbackProps = { title: MessageKey; description: MessageKey; retry?: () => void };
export function FeedbackScreen(props: FeedbackProps) {
  return <I18nProvider><AppearanceProvider><FeedbackContent {...props} /></AppearanceProvider></I18nProvider>;
}
function FeedbackContent({ title, description, retry }: FeedbackProps) {
  const { t } = useI18n();
  return <main className="auth-screen"><div className="feedback-language"><LanguageControl /></div>
    <section className="auth-card" aria-labelledby="feedback-title">
      <ParcelIllustration />
      <p className="auth-card__eyebrow">{t('app.title')}</p>
      <h1 id="feedback-title">{t(title)}</h1><p className="auth-card__intro">{t(description)}</p>
      {retry ? <button type="button" className="button button--primary" onClick={retry}>{t('app.tryAgain')}</button> :
        // A document navigation also retries connectivity from the offline fallback.
        // eslint-disable-next-line @next/next/no-html-link-for-pages
        <a className="button button--primary" href="/">{t(title === 'offline.title' ? 'app.tryAgain' : 'web.backHome')}</a>}
    </section>
  </main>;
}
