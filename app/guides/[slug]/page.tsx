import type { Metadata } from 'next';
import { guideMetadata, GuideRoute } from '../../../src/server/guidePages';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return guideMetadata('en', (await params).slug);
}

/** A guide in English, for anyone, whatever language the browser prefers. Any other slug is the site's 404. */
export default async function EnglishGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  return <GuideRoute locale="en" slug={(await params).slug} />;
}
