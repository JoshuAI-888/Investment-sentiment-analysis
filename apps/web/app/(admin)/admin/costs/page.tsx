import { redirect } from 'next/navigation';
import { AdminDenied } from '@/ui/AdminDenied';
import { requireAdmin, UnauthenticatedError, UnauthorizedError, PasswordChangeRequiredError } from '@/services/auth';
import { getCostLedgerView } from '@/services/admin/reads';

/**
 * F02 §4.4: `requireAdmin()` called in this route's own body. F15 §4.7 — priced, actual and
 * **unpriced** usage shown distinctly. Unpriced never renders as `$0.00`. Threshold *values*
 * are set here (§4.2); enforcement is F18's (§2 Out).
 */
export default async function Page() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    if (error instanceof UnauthorizedError) return <AdminDenied route="/admin/costs" />;
    throw error;
  }

  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const {
    totals,
    breakdown,
    thresholds: { warnUsd, reduceUsd, hardUsd },
  } = await getCostLedgerView(from, now);

  return (
    <main data-route="/admin/costs" className="mx-auto max-w-4xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Costs and budgets</h1>
      <p className="text-sm text-neutral-600">
        D-32: X read ceilings start at zero until the price trigger is verified firing. Edit
        thresholds under Settings — enforcement is F18's.
      </p>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-4" data-cost-summary="">
        <div className="rounded border border-neutral-300 p-4">
          <p className="text-xs uppercase text-neutral-500">Priced spend (MTD)</p>
          <p className="mt-1 text-xl font-semibold" data-cost-total="">
            ${totals.totalUsd}
          </p>
        </div>
        <div className="rounded border border-neutral-300 p-4">
          <p className="text-xs uppercase text-neutral-500">Unpriced calls</p>
          <p className="mt-1 text-xl font-semibold" data-cost-unpriced-count="">
            {totals.unpricedCount === 0 ? '0' : `${totals.unpricedCount} — cost unknown`}
          </p>
        </div>
        <div className="rounded border border-neutral-300 p-4">
          <p className="text-xs uppercase text-neutral-500">Warn / reduce / hard</p>
          <p className="mt-1 text-sm font-mono" data-cost-thresholds="">
            ${warnUsd} / ${reduceUsd} / ${hardUsd}
          </p>
        </div>
        <div className="rounded border border-neutral-300 p-4">
          <p className="text-xs uppercase text-neutral-500">Priced calls</p>
          <p className="mt-1 text-xl font-semibold">{totals.pricedCount}</p>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">By provider / service</h2>
        {breakdown.length === 0 ? (
          <p className="text-sm text-neutral-600" data-cost-breakdown-empty="">
            No cost events recorded this month.
          </p>
        ) : (
          <table className="mt-2 w-full text-left text-sm" data-cost-breakdown-table="">
            <thead>
              <tr className="border-b border-neutral-300 text-xs uppercase text-neutral-500">
                <th className="p-2">Provider</th>
                <th className="p-2">Service</th>
                <th className="p-2">Priced $</th>
                <th className="p-2">Priced calls</th>
                <th className="p-2">Unpriced calls</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((row) => (
                <tr key={`${row.provider}-${row.service}`} className="border-b border-neutral-100">
                  <td className="p-2">{row.provider}</td>
                  <td className="p-2">{row.service}</td>
                  <td className="p-2">${row.pricedUsd}</td>
                  <td className="p-2">{row.pricedCount}</td>
                  <td className="p-2" data-unpriced-count-cell={row.unpricedCount > 0 ? 'nonzero' : 'zero'}>
                    {row.unpricedCount === 0 ? '0' : `${row.unpricedCount} — cost unknown`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
