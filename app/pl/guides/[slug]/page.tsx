import type { Metadata } from 'next';
import { guideMetadata, GuideRoute } from '../../../../src/server/guidePages';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return guideMetadata('pl', (await params).slug);
}

/** A guide in Polish, for anyone, whatever language the browser prefers. Any other slug is the site's 404. */
export default async function PolishGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  return <GuideRoute locale="pl" slug={(await params).slug} />;
}
