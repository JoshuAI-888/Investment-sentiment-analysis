import { redirect } from 'next/navigation';
import { AdminDenied } from '@/ui/AdminDenied';
import { requireAdmin, UnauthenticatedError, UnauthorizedError, PasswordChangeRequiredError } from '@/services/auth';
import { getModelRoutesView } from '@/services/admin/reads';

/**
 * F02 §4.4: `requireAdmin()` called in this route's own body. **Read-only in this build** — the
 * write side is deferred; see this feature's PR body under Deferred.
 */
export default async function Page() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    if (error instanceof UnauthorizedError) return <AdminDenied route="/admin/models" />;
    throw error;
  }

  const { routes } = await getModelRoutesView();

  return (
    <main data-route="/admin/models" className="mx-auto max-w-4xl space-y-4 p-8">
      <h1 className="text-2xl font-semibold">Models</h1>
      <p className="text-sm text-neutral-600">
        Task-scoped model routes for the active config version. Read-only in this build — model
        route mutation is deferred (this feature&apos;s PR body, Deferred section).
      </p>
      {routes.length === 0 ? (
        <p className="text-sm text-neutral-600" data-models-empty="">
          No model routes registered for the active config version yet.
        </p>
      ) : (
        <table className="w-full text-left text-sm" data-models-table="">
          <thead>
            <tr className="border-b border-neutral-300 text-xs uppercase text-neutral-500">
              <th className="p-2">Task</th>
              <th className="p-2">Transport</th>
              <th className="p-2">Provider</th>
              <th className="p-2">Model</th>
              <th className="p-2">Revision</th>
              <th className="p-2">Enabled</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => (
              <tr key={route.task} className="border-b border-neutral-100">
                <td className="p-2">{route.task}</td>
                <td className="p-2">{route.transport}</td>
                <td className="p-2">{route.primaryProvider}</td>
                <td className="p-2">{route.primaryModel}</td>
                <td className="p-2 font-mono text-xs">{route.modelRevision}</td>
                <td className="p-2">{route.enabled ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
