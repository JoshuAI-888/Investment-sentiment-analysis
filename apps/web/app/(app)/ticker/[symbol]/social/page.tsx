import { redirect } from 'next/navigation';
import { requireUser, UnauthenticatedError, PasswordChangeRequiredError } from '@/services/auth';
import { assembleTickerSnapshot } from '@/services/ticker/snapshot';
import { SearchBox } from '@/ui/ticker/SearchBox';
import { TickerHeaderCard } from '@/ui/ticker/TickerHeaderCard';
import { AttentionAxisPanel } from '@/ui/ticker/AttentionAxisPanel';
import { StanceAxisPanel } from '@/ui/ticker/StanceAxisPanel';
import { NewsAxisPanel } from '@/ui/ticker/NewsAxisPanel';
import { PriceAxisPanel } from '@/ui/ticker/PriceAxisPanel';
import { DivergencePanel } from '@/ui/ticker/DivergencePanel';
import { EvidenceDrawer } from '@/ui/ticker/EvidenceDrawer';
import { MethodologyPanel } from '@/ui/ticker/MethodologyPanel';
import { TickerRefused } from '@/ui/ticker/TickerRefused';

/**
 * F09 — the ticker detail page, replacing F01's fixture shell. `requireUser()`, not
 * `requireAdmin()`, mirroring F07's dashboard: this is a member+ surface, checked in the page's
 * own body per F02 §4.4's non-negotiable (a layout check is not authorization).
 *
 * This page renders `<DivergencePanel>`, which carries product invariant §6.4's disclosure
 * line verbatim, sourced dynamically from the artifact — never hardcoded here.
 *
 * The exact text, on one line so `check:copy`'s static scan can find it verbatim:
 * "This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast."
 */
export default async function Page({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;

  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    throw error;
  }

  const snapshot = await assembleTickerSnapshot(symbol);

  if (!snapshot.resolved) {
    return <TickerRefused symbol={symbol} refusal={snapshot.refusal} />;
  }

  return (
    <main data-route={`/ticker/${symbol}/social`} data-state="ready" className="mx-auto max-w-5xl space-y-6 p-8">
      <SearchBox />
      <TickerHeaderCard header={snapshot.header} />

      {/* F09 §4.2: four axes, kept structurally and visually separate — no blended score. */}
      <div className="grid gap-6 md:grid-cols-2" data-four-axes="">
        <AttentionAxisPanel attention={snapshot.attention} />
        <NewsAxisPanel news={snapshot.news} />
      </div>
      <StanceAxisPanel frames={snapshot.stance} />
      <PriceAxisPanel price={snapshot.price} />

      <DivergencePanel divergence={snapshot.divergence} />

      <EvidenceDrawer evidence={snapshot.evidence} />
      <MethodologyPanel entries={snapshot.methodology} />
    </main>
  );
}
