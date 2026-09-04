import type { Finding } from './types';

/**
 * check:calc-coverage — F01 §4.4.
 *
 * Walks the method registry and the rendered-metric manifest, and fails on a metric with no
 * registered method or a method with no goldens.
 *
 * **Ships as a stub that passes on empty.** The registry is F05's and the manifest is the
 * surface features'. The check is here from F01 for the reason §4.4 gives: a check added
 * later is a check that was never able to stop the thing it exists to stop.
 */
export type RegisteredMethod = {
  readonly id: string;
  /** Golden fixtures. A deterministic method with no goldens is untested by construction. */
  readonly goldens: readonly string[];
  /** Present once the method has passed Tier D4. `check:copy` reads this too. */
  readonly tierD4Record?: string;
};

export type RenderedMetric = {
  readonly id: string;
  /** The method that produces it. `null` means the surface renders a number from nowhere. */
  readonly methodId: string | null;
  readonly renderedIn: string;
};

export type CalcCoverageInput = {
  readonly methods: readonly RegisteredMethod[];
  readonly metrics: readonly RenderedMetric[];
};

export function checkCalcCoverage(input: CalcCoverageInput): Finding[] {
  const findings: Finding[] = [];
  const byId = new Map(input.methods.map((method) => [method.id, method]));

  for (const metric of input.metrics) {
    if (metric.methodId === null) {
      findings.push({
        check: 'calc-coverage',
        where: `${metric.renderedIn} — metric '${metric.id}'`,
        message:
          'is rendered with no registered method. Every displayed deterministic value carries a calculation_id resolving to an immutable artifact (product invariant §6.2); a metric with no method has nothing to resolve to.',
      });
      continue;
    }

    if (!byId.has(metric.methodId)) {
      findings.push({
        check: 'calc-coverage',
        where: `${metric.renderedIn} — metric '${metric.id}'`,
        message: `names method '${metric.methodId}', which is not in the registry. Either the method was removed and the surface was not, or the id is a typo — both render a number the Inspector cannot open.`,
      });
    }
  }

  for (const method of input.methods) {
    if (method.goldens.length === 0) {
      findings.push({
        check: 'calc-coverage',
        where: `method '${method.id}'`,
        message:
          'is registered with no golden fixtures. Deterministic metrics are pure functions with golden fixtures (product invariant §6.2) — without one, nothing detects the day its output changes.',
      });
    }
  }

  return findings;
}
