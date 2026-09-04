import { redirect } from 'next/navigation';
import { AdminDenied } from '@/ui/AdminDenied';
import { requireAdmin, UnauthenticatedError, UnauthorizedError, PasswordChangeRequiredError } from '@/services/auth';
import { getAuditEvents } from '@/services/admin/reads';

/** F02 §4.4: `requireAdmin()` called in this route's own body — never only at a layout level. */
export default async function Page() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    if (error instanceof UnauthorizedError) return <AdminDenied route="/admin/audit" />;
    throw error;
  }

  const events = await getAuditEvents({ limit: 100 });

  return (
    <main data-route="/admin/audit" className="mx-auto max-w-5xl space-y-4 p-8">
      <h1 className="text-2xl font-semibold">Audit trail</h1>
      <p className="text-sm text-neutral-600">Every admin mutation and every data-explorer access, actor and before/after included.</p>
      {events.length === 0 ? (
        <p className="text-sm text-neutral-600" data-audit-empty="">
          No audit events recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-audit-table="">
            <thead>
              <tr className="border-b border-neutral-300 text-xs uppercase text-neutral-500">
                <th className="p-2">When</th>
                <th className="p-2">Actor</th>
                <th className="p-2">Action</th>
                <th className="p-2">Object</th>
                <th className="p-2">Result</th>
                <th className="p-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-neutral-100" data-audit-row={event.id}>
                  <td className="p-2 font-mono text-xs">{event.occurredAt.toISOString()}</td>
                  <td className="p-2">{event.actorId}</td>
                  <td className="p-2">{event.action}</td>
                  <td className="p-2 font-mono text-xs">
                    {event.objectType}/{event.objectId}
                  </td>
                  <td className="p-2">{event.result}</td>
                  <td className="p-2 text-xs text-neutral-600">{event.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
