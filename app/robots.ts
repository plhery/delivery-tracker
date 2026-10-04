import type { MetadataRoute } from 'next';
import { siteOrigin } from '../src/server/requestOrigin';

/**
 * Everything may be fetched. A private page says `noindex` itself, which a
 * crawler only reads on a page it may fetch, and the pictures of link previews
 * are drawn under `/api`, for crawlers that obey this file.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: new URL('/sitemap.xml', await siteOrigin()).href,
  };
}
