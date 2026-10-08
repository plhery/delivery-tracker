import type { GuideLink } from '../generated/guides';
import { languagePath, type Locale } from '../lib/locale';
import { languageTags, type Translate } from '../lib/messages';
import { GuideBody } from './GuideBody';
import { GuideCard } from './GuideIndex';
import { GuideScene } from './scenes';
import { wordCount, type Guide } from './markdown';
import { guidePath } from './paths';

/** Words a reader gets through in a minute. */
const READING_PACE = 220;

/** A day as its language writes it. French writes the first of a month "1er", which Intl does not. */
function day(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(languageTags[locale], { dateStyle: 'long', timeZone: 'UTC' }).formatToParts(new Date(`${iso}T00:00:00Z`))
    .map(({ type, value }) => (locale === 'fr' && type === 'day' && value === '1' ? '1er' : value)).join('');
}

/** One guide: its title, its picture, its text, the way to the tracker, and where to read on. */
export function GuidePage({ guide, id, locale, t, links, others }: {
  guide: Guide;
  id: string;
  locale: Locale;
  t: Translate;
  links: readonly GuideLink[];
  /** The guides offered below this one, with what each is about. */
  others: readonly { link: GuideLink; description: string }[];
}) {
  const contents = guide.blocks.filter((block) => block.type === 'heading' && block.level === 2);
  const [lead, rest] = [guide.blocks.slice(0, 1), guide.blocks.slice(1)];
  const sources = t('guides.sources');
  return <>
    <article className="guide">
      <header className="guide__header">
        <a className="guide__crumb" href={guidePath(locale)}>{t('guides.title')}</a>
        <h1>{guide.title}</h1>
        <p className="guide__meta">
          <time dateTime={guide.updated}>{t('guides.updated', { date: day(guide.updated, locale) })}</time>
          <span aria-hidden="true"> · </span>
          {t('guides.minutes', { count: Math.max(1, Math.round(wordCount(guide.blocks) / READING_PACE)) })}
        </p>
      </header>
      <figure className="guide__picture"><GuideScene id={id} label={guide.picture} /></figure>
      {/* The answer comes first, before the list of what else the guide holds. */}
      <div className="guide-body guide-lead"><GuideBody blocks={lead} locale={locale} links={links} sources={sources} /></div>
      <div className="guide__columns">
        {contents.length > 2 && <nav className="guide-contents" aria-labelledby="guide-contents">
          <strong id="guide-contents">{t('guides.contents')}</strong>
          <ol>{contents.map((block) => block.type === 'heading' && <li key={block.id}><a href={`#${block.id}`}>{block.plain}</a></li>)}</ol>
        </nav>}
        <div className="guide-body">
          <GuideBody blocks={rest} locale={locale} links={links} sources={sources} />
        </div>
      </div>
      <aside className="guide-cta">
        <div>
          <strong>{t('guides.cta.title')}</strong>
          <p>{t('guides.cta.body')}</p>
        </div>
        <a className="button button--primary" href={languagePath(locale)}>{t('sample.yours.action')}</a>
      </aside>
    </article>
    {others.length > 0 && <nav className="guide-more" aria-labelledby="guide-more">
      <h2 id="guide-more">{t('guides.more')}</h2>
      <ul className="guide-cards">{others.map(({ link, description }) => <GuideCard key={link.id} link={link} description={description} locale={locale} />)}</ul>
    </nav>}
  </>;
}
