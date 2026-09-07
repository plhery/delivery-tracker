'use client';

import { I18nProvider, useI18n } from '../../src/i18n';

export default function OfflinePage() {
  return <I18nProvider><OfflineContent /></I18nProvider>;
}

function OfflineContent() {
  const { t } = useI18n();
  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="offline-title">
        <div className="auth-card__mark" aria-hidden="true"><span /></div>
        <p className="auth-card__eyebrow">{t('app.title')}</p>
        <h1 id="offline-title">{t('offline.title')}</h1>
        <p className="auth-card__intro">
          {t('offline.description')}
        </p>
        {/* A real navigation retries the document and service worker after connectivity returns. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="button button--primary" href="/">{t('app.tryAgain')}</a>
      </section>
    </main>
  );
}
