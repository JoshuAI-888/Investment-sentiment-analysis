import { redirect } from 'next/navigation';
import { AdminDenied } from '@/ui/AdminDenied';
import { requireAdmin, UnauthenticatedError, UnauthorizedError, PasswordChangeRequiredError } from '@/services/auth';
import { catalogueBySeverity, type DegradationSeverity } from '@/services/degradation/catalogue';

/**
 * F18 §4.3 — the degraded-state catalogue, rendered. F15 left this route a bare fixture shell
 * ("Not built this pass: data sources" — `progress/log/2026-09-05-f15-admin-control-plane.md`);
 * this is the DoD item ("every provider has a catalogued degraded state, a user-visible
 * rendering, and a runbook") given a real home rather than living only in a spec table.
 *
 * `requireAdmin()` in this route's own body, per F02 §4.4's non-negotiable — never only at a
 * layout level.
 *
 * **What this page does not show**, disclosed rather than silently omitted: a live per-provider
 * up/down indicator. The circuit breaker state each adapter maintains (`adapters/breaker.ts`) is
 * in-process only where this codebase's own real deps files construct it
 * (`services/dashboard/provider-deps.ts`, `services/attention/provider-deps.ts` — both document
 * this explicitly), not a persisted, cross-request-queryable table — building one is a real
 * migration and repository addition (SPINE's to own), outside this feature's "additive changes
 * genuinely needed" latitude. Deferred with a named trigger below the table.
 */
const SEVERITY_LABEL: Readonly<Record<DegradationSeverity, string>> = {
  critical: 'Critical — permanent data loss (D-16)',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const SEVERITY_BADGE_CLASS: Readonly<Record<DegradationSeverity, string>> = {
  critical: 'bg-red-100 text-red-800 border-red-300',
  high: 'bg-orange-100 text-orange-800 border-orange-300',
  medium: 'bg-amber-100 text-amber-800 border-amber-300',
  low: 'bg-green-100 text-green-800 border-green-300',
};

export default async function Page() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    if (error instanceof UnauthorizedError) return <AdminDenied route="/admin/data-sources" />;
    throw error;
  }

  const entries = catalogueBySeverity();

  return (
    <main data-route="/admin/data-sources" className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Data sources</h1>
      <p className="text-sm text-neutral-600">
        Every provider this deployment sources from, its degraded state when unavailable, its
        severity, and what to do about it. An outage that costs corpus (D-16, no backfill) is
        ranked above one that only costs latency — the two are not the same kind of incident.
      </p>

      <section className="space-y-4" data-degradation-catalogue="">
        {entries.map((entry) => (
          <article
            key={entry.provider}
            className="rounded border border-neutral-200 p-4"
            data-degradation-row={entry.provider}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{entry.provider}</h2>
              <span
                className={`rounded border px-2 py-0.5 text-xs font-medium ${SEVERITY_BADGE_CLASS[entry.severity]}`}
                data-severity={entry.severity}
              >
                {SEVERITY_LABEL[entry.severity]}
              </span>
            </div>

            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-xs uppercase text-neutral-500">Behavior when unavailable</dt>
                <dd className="mt-0.5 text-neutral-800">{entry.behavior}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-neutral-500">What the reader sees</dt>
                <dd className="mt-0.5 text-neutral-800" data-user-visible-state="">
                  {entry.userVisibleState}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-neutral-500">Why this severity</dt>
                <dd className="mt-0.5 text-neutral-600">{entry.severityReason}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-neutral-500">Runbook</dt>
                <dd className="mt-0.5">
                  <ol className="list-decimal space-y-1 pl-5 text-neutral-800">
                    {entry.runbook.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </section>

      <section className="rounded border border-dashed border-neutral-300 p-4 text-sm text-neutral-600">
        <p className="font-medium text-neutral-700">Deferred</p>
        <p className="mt-1">
          Live per-provider up/down status is not shown here — this deployment&apos;s circuit
          breaker state is in-process only, not a persisted table this page can query. Trigger: a
          persisted breaker-state table (SPINE-owned), once one exists.
        </p>
      </section>
    </main>
  );
}
