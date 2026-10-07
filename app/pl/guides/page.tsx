import type { Metadata } from 'next';
import { guideIndexMetadata, GuideIndexRoute } from '../../../src/server/guidePages';

export async function generateMetadata(): Promise<Metadata> {
  return guideIndexMetadata('pl');
}

/** The guides in Polish, for anyone, whatever language the browser prefers. English is at `/guides`. */
export default function PolishGuidesPage() {
  return <GuideIndexRoute locale="pl" />;
}
