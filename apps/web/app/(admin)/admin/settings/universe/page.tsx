import { redirect } from 'next/navigation';
import { RouteShell } from '@/ui/RouteShell';
import { AdminDenied } from '@/ui/AdminDenied';
import { requireAdmin, UnauthenticatedError, UnauthorizedError, PasswordChangeRequiredError } from '@/services/auth';
import { getActiveUniverseVersion, getUniverseMembers, getUniverseTable } from '@/services/admin/reads';
import { UniverseSelector } from '@/ui/admin/UniverseSelector';

/** F02 §4.4: `requireAdmin()` called in this route's own body — never only at a layout level. */
export default async function Page() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    if (error instanceof UnauthorizedError) return <AdminDenied route="/admin/settings/universe" />;
    throw error;
  }

  const active = await getActiveUniverseVersion();
  const [{ rows, totalCount }, fullMembership] = await Promise.all([
    getUniverseTable({ membershipOfVersion: active?.id, limit: 50, offset: 0 }),
    active === null ? Promise.resolve([]) : getUniverseMembers(active.id),
  ]);

  if (rows.length === 0 && totalCount === 0) {
    return (
      <RouteShell
        route="/admin/settings/universe"
        title="Universe"
        owner="F15 (SURFACE)"
        note="No securities in the local security master yet — F03's seed has not run against a live database in this environment. The selector below activates once security rows exist."
      />
    );
  }

  return (
    <main data-route="/admin/settings/universe" className="mx-auto max-w-6xl space-y-4 p-8">
      <h1 className="text-2xl font-semibold">Universe</h1>
      <p className="text-sm text-neutral-600">
        The 100 most-discussed on Reddit, ranked via ApeWisdom (D-30). Hard cap: 100 active symbols.
      </p>
      <UniverseSelector
        initialRows={rows}
        initialTotalCount={totalCount}
        initialSelected={fullMembership}
        activeVersionId={active?.id ?? null}
      />
    </main>
  );
}
