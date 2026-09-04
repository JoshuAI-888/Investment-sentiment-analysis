import { redirect } from 'next/navigation';
import { requireAdmin, UnauthenticatedError, UnauthorizedError, PasswordChangeRequiredError } from '@/services/auth';
import { getAdminOverview } from '@/services/admin/reads';
import { AdminDenied } from '@/ui/AdminDenied';

const TABS: readonly { readonly href: string; readonly label: string }[] = [
  { href: '/admin', label: 'Status' },
  { href: '/admin/data-sources', label: 'Data sources' },
  { href: '/admin/jobs', label: 'Jobs' },
  { href: '/admin/models', label: 'Models' },
  { href: '/admin/data-explorer', label: 'Data explorer' },
  { href: '/admin/costs', label: 'Costs' },
  { href: '/admin/settings', label: 'Settings' },
  { href: '/admin/settings/universe', label: 'Universe' },
  { href: '/admin/audit', label: 'Audit' },
  { href: '/admin/calculations', label: 'Calculations' },
  { href: '/admin/user-assumptions', label: 'User assumptions' },
  { href: '/admin/calculation-issues', label: 'Calculation issues' },
];

/** F02 §4.4: `requireAdmin()` called in this route's own body — never only at a layout level. */
export default async function Page() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    if (error instanceof UnauthorizedError) return <AdminDenied route="/admin" />;
    throw error;
  }

  const { config, universe, openIssueCount, recentAudit } = await getAdminOverview();

  return (
    <main data-route="/admin" className="mx-auto max-w-4xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Operator control plane</h1>
      <nav className="flex flex-wrap gap-2 text-sm" data-admin-nav="">
        {TABS.map((tab) => (
          <a key={tab.href} href={tab.href} className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100">
            {tab.label}
          </a>
        ))}
      </nav>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-admin-status="">
        <div className="rounded border border-neutral-300 p-4">
          <p className="text-xs uppercase text-neutral-500">Active config version</p>
          <p className="mt-1 font-mono text-sm" data-config-version="">
            {config === null ? 'none' : `#${config.id}`}
          </p>
          <p className="mt-1 text-xs text-neutral-600">{config?.changeReason ?? 'No config version has ever been activated.'}</p>
        </div>
        <div className="rounded border border-neutral-300 p-4">
          <p className="text-xs uppercase text-neutral-500">Active universe</p>
          <p className="mt-1 font-mono text-sm" data-universe-version="">
            {universe === null ? 'none' : `#${universe.id} — ${universe.selectedCount} symbols`}
          </p>
        </div>
        <div className="rounded border border-neutral-300 p-4">
          <p className="text-xs uppercase text-neutral-500">Open calculation issues</p>
          <p className="mt-1 text-2xl font-semibold" data-open-issue-count="">
            {openIssueCount}
          </p>
        </div>
      </section>

      <section data-recent-audit="">
        <h2 className="text-lg font-semibold">Recent audit activity</h2>
        {recentAudit.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">No audit events recorded yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-200 text-sm">
            {recentAudit.map((event) => (
              <li key={event.id} className="py-2">
                <span className="font-mono text-xs text-neutral-500">{event.occurredAt.toISOString()}</span>{' '}
                <span className="font-medium">{event.action}</span> on {event.objectType}/{event.objectId} by{' '}
                {event.actorId} — {event.result}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
