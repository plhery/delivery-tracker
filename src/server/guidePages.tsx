import 'server-only';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { GuideFrame } from '../guides/GuideFrame';
import { GuideIndex } from '../guides/GuideIndex';
import { GuidePage } from '../guides/GuidePage';
import { frenchSpacing } from '../guides/markdown';
import { SUPPORTED_LOCALES, type Locale } from '../lib/locale';
import type { Translate } from '../lib/messages';
import { guide, guideAddresses, guideAlternates, guideLinkBySlug, guideLinks } from './guides';
import { jsonForScript } from './landingStructuredData';
import { messagesFor } from './requestLocale';
import { requestOrigin, siteOrigin } from './requestOrigin';
import { PREVIEW_LOCALES, sitePicture, wordsIn } from './sitePreview';

/** How many other guides a guide offers below its text. */
const READ_ON = 3;

/** The words of a guides page. French sets its punctuation there as its guides do. */
function guideWords(locale: Locale): Translate {
  const t = wordsIn(locale);
  return locale === 'fr' ? (key, variables) => frenchSpacing(t(key, variables)) : t;
}

const languageNames = () => Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, messagesFor(locale)[`language.${locale}`]])) as Record<Locale, string>;

/**
 * A guides page's metadata: its title with Peek's name, its address in every language on the
 * site's canonical origin, and Peek's own picture in the page's language.
 */
async function pageMetadata(locale: Locale, id: string | undefined, title: string, description: string, article?: { published: string; updated: string }): Promise<Metadata> {
  const origin = await requestOrigin();
  const languages = guideAlternates(await siteOrigin(), id);
  const address = languages[locale];
  const picture = sitePicture(origin, locale);
  return {
    metadataBase: origin,
    title: `${title} — Peek`,
    description,
    alternates: { canonical: address, languages },
    openGraph: {
      ...(article ? { type: 'article', publishedTime: article.published, modifiedTime: article.updated } : { type: 'website' }),
      url: address,
      siteName: 'Peek',
      locale: PREVIEW_LOCALES[locale],
      title,
      description,
      images: [picture],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [picture.url],
    },
  };
}

export async function guideIndexMetadata(locale: Locale): Promise<Metadata> {
  const t = guideWords(locale);
  return pageMetadata(locale, undefined, t('guides.heading'), t('guides.lead'));
}

/** A guide's metadata, or none of its own for a slug without a guide, which the page answers with a 404. */
export async function guideMetadata(locale: Locale, slug: string): Promise<Metadata> {
  const link = guideLinkBySlug(locale, slug);
  if (!link) return {};
  const { title, description, published, updated } = guide(locale, link.id);
  return pageMetadata(locale, link.id, title, description, { published, updated });
}

const described = (locale: Locale) => guideLinks(locale).map((link) => ({ link, description: guide(locale, link.id).description }));

/** The guides of a language, all on one page. */
export async function GuideIndexRoute({ locale }: { locale: Locale }) {
  await connection();
  const t = guideWords(locale);
  return <GuideFrame locale={locale} t={t} addresses={guideAddresses()} languageNames={languageNames()} screen={`guides/${locale}`}>
    <GuideIndex locale={locale} t={t} guides={described(locale)} />
  </GuideFrame>;
}

/**
 * One guide, in the language of its address. A rewrite in `next.config.ts` sends an address without a
 * guide to the site's 404 page before it gets here; reached anyway, such a slug is still a 404.
 */
export async function GuideRoute({ locale, slug }: { locale: Locale; slug: string }) {
  await connection();
  const links = guideLinks(locale);
  const at = links.findIndex((link) => link.slug === slug);
  if (at < 0) notFound();
  const link = links[at];
  const text = guide(locale, link.id);
  const t = guideWords(locale);
  const site = await siteOrigin();
  const alternates = guideAlternates(site, link.id);
  const url = alternates[locale];
  const peek = { '@type': 'Organization', name: 'Peek', url: site.href, logo: { '@type': 'ImageObject', url: new URL('/icons/icon-512.png', site).href } };
  // The guides that follow this one in the list, around its end.
  const others = described(locale).filter((other) => other.link.id !== link.id);
  const next = [...others.slice(at), ...others.slice(0, at)].slice(0, READ_ON);
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
          { '@type': 'ListItem', position: 1, name: 'Peek', item: site.href },
          { '@type': 'ListItem', position: 2, name: t('guides.title'), item: guideAlternates(site)[locale] },
          { '@type': 'ListItem', position: 3, name: text.title, item: url },
        ],
      },
    ],
  };
  return <GuideFrame locale={locale} t={t} addresses={guideAddresses(link.id)} languageNames={languageNames()} screen={`guides/${locale}/${link.id}`}>
    {/* Data, not a script: the browser runs nothing of it, so the page's script policy does not apply. */}
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonForScript(data) }} />
    <GuidePage guide={text} id={link.id} locale={locale} t={t} links={links} others={next} />
  </GuideFrame>;
}
