import type { GuideLink } from '../generated/guides';
import type { Locale } from '../lib/locale';
import type { Translate } from '../lib/messages';
import { guidePath } from './paths';
import { GuideScene } from './scenes';

/** A guide as a card: its picture, its title, and what it answers. */
export function GuideCard({ link, description, locale }: { link: GuideLink; description: string; locale: Locale }) {
  return <li>
    <a className="guide-card" href={guidePath(locale, link.slug)}>
      <span className="guide-card__picture"><GuideScene id={link.id} /></span>
      <strong>{link.title}</strong>
      <span>{description}</span>
    </a>
  </li>;
}

/** The guides of a language, all on one page. */
export function GuideIndex({ locale, t, guides }: {
  locale: Locale;
  t: Translate;
  guides: readonly { link: GuideLink; description: string }[];
}) {
  return <section className="guide-index" aria-labelledby="guide-index">
    <header className="guide__header">
      <p className="guide__crumb">{t('guides.title')}</p>
      <h1 id="guide-index">{t('guides.heading')}</h1>
      <p className="guide-lead">{t('guides.lead')}</p>
    </header>
    <ul className="guide-cards">{guides.map(({ link, description }) => <GuideCard key={link.id} link={link} description={description} locale={locale} />)}</ul>
  </section>;
}
