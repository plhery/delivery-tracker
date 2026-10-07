import type { Metadata } from 'next';
import { guideMetadata, GuideRoute } from '../../../../src/server/guidePages';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return guideMetadata('de', (await params).slug);
}

/** A guide in German, for anyone, whatever language the browser prefers. Any other slug is the site's 404. */
export default async function GermanGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  return <GuideRoute locale="de" slug={(await params).slug} />;
}
