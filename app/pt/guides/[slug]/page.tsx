import type { Metadata } from 'next';
import { guideMetadata, GuideRoute } from '../../../../src/server/guidePages';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return guideMetadata('pt', (await params).slug);
}

/** A guide in Portuguese, for anyone, whatever language the browser prefers. Any other slug is the site's 404. */
export default async function PortugueseGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  return <GuideRoute locale="pt" slug={(await params).slug} />;
}
