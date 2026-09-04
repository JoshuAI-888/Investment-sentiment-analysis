import { redirect } from 'next/navigation';
import { requireUser, UnauthenticatedError, PasswordChangeRequiredError } from '@/services/auth';
import { assembleDashboard } from '@/services/dashboard/assemble';
import { resolveRedisClient } from '@/services/dashboard/redis';
import { DegradedPanel } from '@/ui/DegradedPanel';
import { EmptyState } from '@/ui/dashboard/EmptyState';
import { MarketCompositeCard } from '@/ui/dashboard/MarketCompositeCard';
import { RefreshControl } from '@/ui/dashboard/RefreshControl';
import { SectorProxyGrid } from '@/ui/dashboard/SectorProxyGrid';

/**
 * F07 — the dashboard, replacing F01's fixture shell.
 *
 * `requireUser()`, not `requireAdmin()`: F07 §2/§4.6 call this a "member+" surface, and D-11
 * voided `AccountTier`/`requireTier()` — there is one account and it is not admin-only for
 * *viewing* the primary landing surface (unlike `/admin/*`, which every one of F02's routes
 * gates with `requireAdmin()`). Called in this page's own body, per F02 §4.4's non-negotiable:
 * authorization is re-checked in the handler, never assumed from a layout.
 */
export default async function Page() {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    throw error;
  }

  const redis = resolveRedisClient();
  const dashboard = await assembleDashboard({ redis });

  return (
    <main data-route="/dashboard" data-state={dashboard.state} className="mx-auto max-w-5xl space-y-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <RefreshControl initialRefusal={dashboard.lastRefusal} />
      </div>

      <DegradedPanel providers={dashboard.degradedProviders} />

      {dashboard.state === 'empty' ? (
        <EmptyState computedDepth={dashboard.computedDepth} />
      ) : (
        <>
          <MarketCompositeCard view={dashboard.marketComposite} />
          <SectorProxyGrid tiles={dashboard.sectorTiles} />
        </>
      )}
    </main>
  );
}
