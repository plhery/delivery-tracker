const paths = {
  pencil: 'M4 20h4L19 9l-4-4L4 16v4Zm11-15 4 4',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5v-5m0-3h.01',
  warning: 'M12 4 2.5 20h19L12 4Zm0 6v4m0 3h.01',
  offline: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M19 13a10 10 0 0 0-2.2-1.6M2 9.5a15 15 0 0 1 4.3-2.8M22 9.5A15 15 0 0 0 11 5.1M12 20h.01',
  back: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  calendar: 'M4 6h16v15H4V6Zm0 5h16M8 3v5m8-5v5',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6m-6 4h3',
} as const;

export type GlyphName = keyof typeof paths;

/** The parcel page's own line icons, drawn like the app's `Icon`. */
export function Glyph({ name }: { name: GlyphName }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
