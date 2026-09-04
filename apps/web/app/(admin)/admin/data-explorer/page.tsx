import { redirect } from 'next/navigation';
import { AdminDenied } from '@/ui/AdminDenied';
import { requireAdmin, UnauthenticatedError, UnauthorizedError, PasswordChangeRequiredError } from '@/services/auth';
import { DataExplorer } from '@/ui/admin/DataExplorer';

/** F02 §4.4: `requireAdmin()` called in this route's own body — never only at a layout level. */
export default async function Page() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    if (error instanceof UnauthorizedError) return <AdminDenied route="/admin/data-explorer" />;
    throw error;
  }

  return (
    <main data-route="/admin/data-explorer" className="mx-auto max-w-5xl space-y-4 p-8">
      <h1 className="text-2xl font-semibold">Data explorer</h1>
      <p className="text-sm text-neutral-600">
        Sanitized payload inspection. Rights-restricted and retention-expired payloads are never
        returned. Every access — including a search that finds nothing — is audited.
      </p>
      <DataExplorer />
    </main>
  );
}
