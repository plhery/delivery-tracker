import type { Metadata } from 'next';
import { guideIndexMetadata, GuideIndexRoute } from '../../src/server/guidePages';

export async function generateMetadata(): Promise<Metadata> {
  return guideIndexMetadata('en');
}

/** The guides in English, for anyone, whatever language the browser prefers. The other languages are at `/<language>/guides`. */
export default function EnglishGuidesPage() {
  return <GuideIndexRoute locale="en" />;
}
