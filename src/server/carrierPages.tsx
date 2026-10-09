import 'server-only';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { CarrierIndex } from '../carriers/CarrierIndex';
import { CarrierPage } from '../carriers/CarrierPage';
import { GuideFrame } from '../guides/GuideFrame';
import { plainBlocks, questions } from '../guides/markdown';
import type { Locale } from '../lib/locale';
import { carrierAddresses, carrierAlternates, carrierLinkBySlug, carrierLinks, carrierText } from './carrierTexts';
import { guideWords, languageNames, pageMetadata } from './guidePages';
import { guideLinks } from './guides';
import { landingAddress } from './landingMetadata';
import { jsonForScript } from './landingStructuredData';
import { siteOrigin } from './requestOrigin';
import { sitePicture } from './sitePreview';

export async function carrierIndexMetadata(locale: Locale): Promise<Metadata> {
  const t = guideWords(locale);
  return pageMetadata(locale, (site) => carrierAlternates(site), t('carriers.heading'), t('carriers.lead'));
}

/** A carrier's page's metadata, or none of its own for a slug without a page, which the page answers with a 404. */
export async function carrierMetadata(locale: Locale, slug: string): Promise<Metadata> {
  const link = carrierLinkBySlug(locale, slug);
  if (!link) return {};
  const { title, description, published, updated } = carrierText(locale, link.id);
  return pageMetadata(locale, (site) => carrierAlternates(site, link.id), title, description, { published, updated });
}

const described = (locale: Locale) => carrierLinks(locale).map((link) => ({ link, description: carrierText(locale, link.id).description }));

/** The carriers with a page in a language, all on one page. */
export async function CarrierIndexRoute({ locale }: { locale: Locale }) {
  await connection();
  const t = guideWords(locale);
  return <GuideFrame locale={locale} t={t} addresses={carrierAddresses()} languageNames={languageNames()} screen={`carriers/${locale}`}>
    <CarrierIndex locale={locale} t={t} carriers={described(locale)} />
  </GuideFrame>;
}

/**
 * One carrier's page, in the language of its address. The proxy sends an address without a page, a
 * carrier's in a language it is not written in too, to the site's 404 page before it gets here; reached
 * anyway, such a slug is still a 404. Its language links lead to the carrier's page in the languages it is
 * written in, and to the carriers' own page in the others.
 */
export async function CarrierRoute({ locale, slug }: { locale: Locale; slug: string }) {
  await connection();
  const link = carrierLinkBySlug(locale, slug);
  if (!link) notFound();
  const text = carrierText(locale, link.id);
  const t = guideWords(locale);
  const site = await siteOrigin();
  const url = carrierAlternates(site, link.id)[locale];
  const peek = { '@type': 'Organization', name: 'Peek', url: site.href, logo: { '@type': 'ImageObject', url: new URL('/icons/icon-512.png', site).href } };
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article', headline: text.title, description: text.description, inLanguage: locale,
        datePublished: text.published, dateModified: text.updated, mainEntityOfPage: url,
        image: sitePicture(site, locale).url, author: peek, publisher: peek,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Peek', item: landingAddress(site, locale) },
          { '@type': 'ListItem', position: 2, name: t('carriers.title'), item: carrierAlternates(site)[locale] },
          { '@type': 'ListItem', position: 3, name: text.title, item: url },
        ],
      },
      // The questions the page's last section answers, each answer as plain words.
      {
        '@type': 'FAQPage', inLanguage: locale, url,
        mainEntity: questions(text.blocks).map(({ question, answer }) => ({
          '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: plainBlocks(answer) },
        })),
      },
    ],
  };
  return <GuideFrame locale={locale} t={t} addresses={carrierAddresses(link.id)} languageNames={languageNames()} screen={`carriers/${locale}/${link.id}`}>
    {/* Data, not a script: the browser runs nothing of it, so the page's script policy does not apply. */}
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonForScript(data) }} />
    <CarrierPage text={text} carrier={link} locale={locale} t={t} guides={guideLinks(locale)}
      others={described(locale).filter((other) => other.link.id !== link.id)} />
  </GuideFrame>;
}
