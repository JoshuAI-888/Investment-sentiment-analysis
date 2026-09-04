/**
 * F09 §4.4 — the methodology panel: "Per axis: source, window, method, method version,
 * thresholds, and a link to the Inspector. The stance entry reproduces the registry's
 * `limitations[]` — the selection-bias disclosure appears on the page a user actually reads, not
 * only in the Inspector." Reads `METHOD_REGISTRY` (the single runtime description of a metric,
 * `02-ARCHITECTURE-CONTRACTS.md` §4.3) rather than re-describing any method's rules here.
 *
 * The Inspector href is built inline (mirroring `ui/inspector-links.ts#inspectorHref`'s
 * `/calculations/{calculationId}` shape) rather than imported from it — `services/` may not
 * import `ui/` (`02-ARCHITECTURE-CONTRACTS.md` §3, enforced by `layer-direction`). Both sides
 * address a calculation identically; `tests/unit/services/ticker/methodology.test.ts` pins this
 * module's own copy of the format.
 */
import { METHOD_REGISTRY } from '@/services/calculations';
import type { MethodologyEntry } from './contract';

function inspectorHref(calculationId: string): string {
  return `/calculations/${encodeURIComponent(calculationId)}`;
}

export function methodologyEntryFor(args: {
  readonly axis: string;
  readonly methodId: string;
  readonly source: string;
  readonly window: string;
  /** Present when an artifact was computed this render — absent when the axis abstained upstream of any computation. */
  readonly calculationId?: string | null;
}): MethodologyEntry {
  const entry = METHOD_REGISTRY.latest(args.methodId);

  const thresholds = Object.entries(entry.officialAssumptions).map(([key, value]) => {
    const editable = entry.editableAssumptions.find((candidate) => candidate.key === key);
    return { key, value, unit: editable?.unit ?? '' };
  });

  return {
    axis: args.axis,
    methodId: entry.id,
    methodVersion: entry.version,
    title: entry.title,
    source: args.source,
    window: args.window,
    thresholds,
    limitations: [...entry.limitations],
    inspectorHref:
      args.calculationId === undefined || args.calculationId === null
        ? null
        : inspectorHref(args.calculationId),
  };
}
