import { redirect } from 'next/navigation';

/**
 * Source §6.2 lists no route at `/`. A deployment whose root 404s reads as broken rather than
 * as unbuilt, so the root redirects to the landing surface instead of inventing a page.
 */
export default function Home() {
  redirect('/dashboard');
}
