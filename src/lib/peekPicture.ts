/**
 * Peek's own link preview: the picture a page shares unless it draws its own.
 * The address names the picture's contents, so a redrawn one replaces cached copies.
 */
export const PEEK_PICTURE_PATH = '/og.png?v=73229339';

export function peekPicture(origin: URL) {
  return {
    url: new URL(PEEK_PICTURE_PATH, origin).href,
    width: 1_200,
    height: 630,
    alt: 'Peek, the universal parcel tracker: “Where’s my parcel?” beside a kraft parcel with a friendly face.',
  };
}
