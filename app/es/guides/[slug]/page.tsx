import type { Metadata } from 'next';
import { guideMetadata, GuideRoute } from '../../../../src/server/guidePages';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return guideMetadata('es', (await params).slug);
}

/** A guide in Spanish, for anyone, whatever language the browser prefers. Any other slug is the site's 404. */
export default async function SpanishGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  return <GuideRoute locale="es" slug={(await params).slug} />;
}
