import type { Locale } from './locale';
import versions from './peekPictures.json';

/**
 * Peek's own link preview, in a reader's language: the picture a page shares unless it
 * draws its own. The address names the picture's contents, so a redrawn one replaces
 * cached copies. `npm run icons` draws the pictures and writes their versions.
 */
export function peekPicturePath(locale: Locale): string {
  return `/og${locale === 'en' ? '' : `-${locale}`}.png?v=${versions[locale]}`;
}
