import type { CarrierLink } from '../generated/carriers';
import type { GuideLink } from '../generated/guides';
import { GuideCta, GuideMeta, GuideText } from '../guides/GuidePage';
import type { CarrierText } from '../guides/markdown';
import type { Locale } from '../lib/locale';
import type { Translate } from '../lib/messages';
import { CarrierCard } from './CarrierIndex';
import { CarrierTracker } from './CarrierTracker';
import { carrierPath } from './paths';

/**
 * One carrier's page: its title, the tracker for its parcels right below, its
 * text, the way to the tracker again, and the language's other carriers. It
 * has no picture: the tracker stands where a guide's picture does.
 */
export function CarrierPage({ text, carrier, locale, t, guides, others }: {
  text: CarrierText;
  carrier: CarrierLink;
  locale: Locale;
  t: Translate;
  /** The guides of the page's language, which its text may link. */
  guides: readonly GuideLink[];
  /** The other carriers with a page in this language, with what each answers. */
  others: readonly { link: CarrierLink; description: string }[];
}) {
  return <>
    <article className="guide">
      <header className="guide__header">
        <a className="guide__crumb" href={carrierPath(locale)}>{t('carriers.title')}</a>
        <h1>{text.title}</h1>
        <GuideMeta updated={text.updated} blocks={text.blocks} locale={locale} t={t} />
      </header>
      <CarrierTracker locale={locale} color={carrier.color} label={t('carriers.track.label', { carrier: carrier.name })}
        placeholder={t('add.trackingPlaceholder')} action={t('sample.yours.action')} note={t('carriers.independent', { carrier: carrier.name })} />
      <GuideText blocks={text.blocks} locale={locale} t={t} links={guides} />
      <GuideCta locale={locale} t={t} />
    </article>
    {others.length > 0 && <nav className="guide-more" aria-labelledby="guide-more">
      <h2 id="guide-more">{t('carriers.more')}</h2>
      <ul className="guide-cards">{others.map(({ link, description }) => <CarrierCard key={link.id} link={link} description={description} locale={locale} />)}</ul>
    </nav>}
  </>;
}
