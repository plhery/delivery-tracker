import type { Metadata } from 'next';
import { guideIndexMetadata, GuideIndexRoute } from '../../../src/server/guidePages';

export async function generateMetadata(): Promise<Metadata> {
  return guideIndexMetadata('it');
}

/** The guides in Italian, for anyone, whatever language the browser prefers. English is at `/guides`. */
export default function ItalianGuidesPage() {
  return <GuideIndexRoute locale="it" />;
}
