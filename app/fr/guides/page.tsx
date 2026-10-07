import type { Metadata } from 'next';
import { guideIndexMetadata, GuideIndexRoute } from '../../../src/server/guidePages';

export async function generateMetadata(): Promise<Metadata> {
  return guideIndexMetadata('fr');
}

/** The guides in French, for anyone, whatever language the browser prefers. English is at `/guides`. */
export default function FrenchGuidesPage() {
  return <GuideIndexRoute locale="fr" />;
}
