import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdminDenied } from '@/ui/AdminDenied';
import {
  PasswordChangeRequiredError,
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
} from '@/services/auth';

/** F02 §4.4: `requireAdmin()` called in this route's own body — never only at a layout level. */
export default async function Page() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    if (error instanceof UnauthorizedError) return <AdminDenied route="/admin/settings" />;
    throw error;
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8" data-state="ready">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-neutral-500">Administration</p>
        <h1 className="text-3xl font-semibold">Settings</h1>
        <p>Review and stage governed settings for future work.</p>
      </header>
      <nav aria-label="Admin settings" className="grid gap-4 sm:grid-cols-2">
        <Link className="rounded border p-4 hover:bg-neutral-50" href="/admin/settings/rni-ai">
          <strong className="block">RNI model call limits</strong>
          <span>Change bounded per-task limits by staging a reviewed successor.</span>
        </Link>
        <Link className="rounded border p-4 hover:bg-neutral-50" href="/admin/settings/universe">
          <strong className="block">RNI S&amp;P 500 universe</strong>
          <span>Refresh and review the configured security universe.</span>
        </Link>
      </nav>
    </main>
  );
}
