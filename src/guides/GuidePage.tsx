import type { GuideLink } from '../generated/guides';
import { languagePath, type Locale } from '../lib/locale';
import { languageTags, type Translate } from '../lib/messages';
import { GuideBody } from './GuideBody';
import type { CheckerWords } from './NumberChecker';
import { GuideCard } from './GuideIndex';
import { GuideScene } from './scenes';
import { wordCount, type Block, type Guide } from './markdown';
import { guidePath } from './paths';

/** Words a reader gets through in a minute. */
const READING_PACE = 220;

/** A day as its language writes it. French writes the first of a month "1er", which Intl does not. */
function day(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(languageTags[locale], { dateStyle: 'long', timeZone: 'UTC' }).formatToParts(new Date(`${iso}T00:00:00Z`))
    .map(({ type, value }) => (locale === 'fr' && type === 'day' && value === '1' ? '1er' : value)).join('');
}

/** When a page's facts were last checked, and how long it takes to read. */
export function GuideMeta({ updated, blocks, locale, t }: { updated: string; blocks: readonly Block[]; locale: Locale; t: Translate }) {
  return <p className="guide__meta">
    <time dateTime={updated}>{t('guides.updated', { date: day(updated, locale) })}</time>
    <span aria-hidden="true"> · </span>
    {t('guides.minutes', { count: Math.max(1, Math.round(wordCount(blocks) / READING_PACE)) })}
  </p>;
}

/** A page's text: its first paragraph, the answer, then the list of its sections and the rest. */
export function GuideText({ blocks, locale, t, links }: { blocks: readonly Block[]; locale: Locale; t: Translate; links: readonly GuideLink[] }) {
  const contents = blocks.filter((block) => block.type === 'heading' && block.level === 2);
  const [lead, rest] = [blocks.slice(0, 1), blocks.slice(1)];
  const sources = t('guides.sources');
  const checker: CheckerWords = {
    label: t('guides.checker.label'), placeholder: t('add.trackingPlaceholder'), action: t('sample.yours.action'), hint: t('guides.checker.hint'),
    certain: t('add.detectedCarrier'), maybe: t('guides.checker.maybe'), maybeNote: t('guides.checker.maybeNote'), none: t('guides.checker.none'),
    typo: t('door.typo.check'), suggest: t('door.typo.suggest', { number: '{{number}}' }), orderTitle: t('door.order.title'), orderBody: t('door.order.body'),
  };
  return <>
    {/* The answer comes first, before the list of what else the page holds. */}
    <div className="guide-body guide-lead"><GuideBody blocks={lead} locale={locale} links={links} sources={sources} checker={checker} /></div>
    <div className="guide__columns">
      {contents.length > 2 && <nav className="guide-contents" aria-labelledby="guide-contents">
        <strong id="guide-contents">{t('guides.contents')}</strong>
        <ol>{contents.map((block) => block.type === 'heading' && <li key={block.id}><a href={`#${block.id}`}>{block.plain}</a></li>)}</ol>
      </nav>}
      <div className="guide-body">
        <GuideBody blocks={rest} locale={locale} links={links} sources={sources} checker={checker} />
      </div>
    </div>
  </>;
}

/** The way to the tracker below a page's text: the landing in the page's language. */
export function GuideCta({ locale, t }: { locale: Locale; t: Translate }) {
  return <aside className="guide-cta">
    <div>
      <strong>{t('guides.cta.title')}</strong>
      <p>{t('guides.cta.body')}</p>
    </div>
    <a className="button button--primary" href={languagePath(locale)}>{t('sample.yours.action')}</a>
  </aside>;
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
  return <>
    <article className="guide">
      <header className="guide__header">
        <a className="guide__crumb" href={guidePath(locale)}>{t('guides.title')}</a>
        <h1>{guide.title}</h1>
        <GuideMeta updated={guide.updated} blocks={guide.blocks} locale={locale} t={t} />
      </header>
      <figure className="guide__picture"><GuideScene id={id} label={guide.picture} /></figure>
      <GuideText blocks={guide.blocks} locale={locale} t={t} links={links} />
      <GuideCta locale={locale} t={t} />
    </article>
    {others.length > 0 && <nav className="guide-more" aria-labelledby="guide-more">
      <h2 id="guide-more">{t('guides.more')}</h2>
      <ul className="guide-cards">{others.map(({ link, description }) => <GuideCard key={link.id} link={link} description={description} locale={locale} />)}</ul>
    </nav>}
  </>;
}
