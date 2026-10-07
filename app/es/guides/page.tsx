import type { Metadata } from 'next';
import { guideIndexMetadata, GuideIndexRoute } from '../../../src/server/guidePages';

export async function generateMetadata(): Promise<Metadata> {
  return guideIndexMetadata('es');
}

/** The guides in Spanish, for anyone, whatever language the browser prefers. English is at `/guides`. */
export default function SpanishGuidesPage() {
  return <GuideIndexRoute locale="es" />;
}
