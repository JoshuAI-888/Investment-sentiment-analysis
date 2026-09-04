import { redirect } from 'next/navigation';
import { AdminDenied } from '@/ui/AdminDenied';
import { requireAdmin, UnauthenticatedError, UnauthorizedError, PasswordChangeRequiredError } from '@/services/auth';
import { getCalculationIssuesView } from '@/services/admin/reads';
import { CalculationIssueList } from '@/ui/admin/CalculationIssueList';

/**
 * F02 §4.4: `requireAdmin()` called in this route's own body. F15 §4.6 — the calculation-issue
 * queue (kept in this build; scope note in the feature's PR body under Decisions — the D-11
 * amendment banner at the top of the F15 spec lists it among what D-11 cuts, but the table
 * already exists as merged F05 schema with real callers, so per this repo's own tree-wins rule
 * this build keeps it).
 */
export default async function Page() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    if (error instanceof UnauthorizedError) return <AdminDenied route="/admin/calculation-issues" />;
    throw error;
  }

  const issues = await getCalculationIssuesView({ status: 'new', limit: 100 });

  return (
    <main data-route="/admin/calculation-issues" className="mx-auto max-w-4xl space-y-4 p-8">
      <h1 className="text-2xl font-semibold">Calculation issues</h1>
      <p className="text-sm text-neutral-600">
        Resolution names a different, already-computed calculation — it never mutates the
        original.
      </p>
      <CalculationIssueList
        initialIssues={issues.map((issue) => ({
          id: issue.id,
          calculationId: issue.calculationId,
          issueType: issue.issueType,
          description: issue.description,
          status: issue.status,
          updatedAt: issue.updatedAt.toISOString(),
        }))}
      />
    </main>
  );
}
