import type { Metadata } from 'next';
import { researcherSignedIn } from '@/server/research-auth';
import ResearchPortal from './research-portal';
import './research.css';

export const metadata: Metadata = { title: 'Researcher workspace | CoStudio' };
export const dynamic = 'force-dynamic';

export default async function ResearchPage() {
  return <ResearchPortal initiallySignedIn={await researcherSignedIn()} />;
}
