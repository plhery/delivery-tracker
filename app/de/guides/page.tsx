import type { Metadata } from 'next';
import { guideIndexMetadata, GuideIndexRoute } from '../../../src/server/guidePages';

export async function generateMetadata(): Promise<Metadata> {
  return guideIndexMetadata('de');
}

/** The guides in German, for anyone, whatever language the browser prefers. English is at `/guides`. */
export default function GermanGuidesPage() {
  return <GuideIndexRoute locale="de" />;
}
