import type { Metadata } from 'next';
import { guideIndexMetadata, GuideIndexRoute } from '../../../src/server/guidePages';

export async function generateMetadata(): Promise<Metadata> {
  return guideIndexMetadata('pt');
}

/** The guides in Portuguese, for anyone, whatever language the browser prefers. English is at `/guides`. */
export default function PortugueseGuidesPage() {
  return <GuideIndexRoute locale="pt" />;
}
