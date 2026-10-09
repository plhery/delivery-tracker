import type { CarrierLink } from '../generated/carriers';
import type { Locale } from '../lib/locale';
import type { Translate } from '../lib/messages';
import { carrierPath } from './paths';

/** A dot of a carrier's colour beside its name. The colour marks the carrier; no word ever stands on it. */
export function CarrierSwatch({ color }: { color: string }) {
  return <span className="carrier-swatch" style={{ background: color }} aria-hidden="true" />;
}

/** A carrier's page as a card: the carrier's name by its colour, the page's title, and what it answers. */
export function CarrierCard({ link, description, locale }: { link: CarrierLink; description: string; locale: Locale }) {
  return <li>
    <a className="guide-card carrier-card" href={carrierPath(locale, link.slug)}>
      <span className="carrier-card__name"><CarrierSwatch color={link.color} />{link.name}</span>
      <strong>{link.title}</strong>
      <span>{description}</span>
    </a>
  </li>;
}

/** The carriers with a page in a language, all on one page. */
export function CarrierIndex({ locale, t, carriers }: {
  locale: Locale;
  t: Translate;
  carriers: readonly { link: CarrierLink; description: string }[];
}) {
  return <section className="guide-index" aria-labelledby="carrier-index">
    <header className="guide__header">
      <p className="guide__crumb">{t('carriers.title')}</p>
      <h1 id="carrier-index">{t('carriers.heading')}</h1>
      <p className="guide-lead">{t('carriers.lead')}</p>
    </header>
    {carriers.length > 0 && <ul className="guide-cards">{carriers.map(({ link, description }) => <CarrierCard key={link.id} link={link} description={description} locale={locale} />)}</ul>}
  </section>;
}
