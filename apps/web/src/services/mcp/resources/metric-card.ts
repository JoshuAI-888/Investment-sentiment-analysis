/**
 * `ui://metric-card` (F21 §4.4) — "One metric: value, `n`, window, per-axis label, §6.4 line or
 * the Tier D4 record." §4.5: "The component reads the registry to decide which [disclosure] — it
 * is never a prop the caller sets."
 *
 * **What is, and is not, caller-suppliable, and why that split is deliberate.** `calculationId`
 * is the only identity the caller passes — everything about *what was computed* (`methodId`,
 * `methodVersion`, the result, `eligibility`) is re-read from the artifact itself
 * (`services/calculations.ts#loadArtifact`), and the disclosure/`mustNotClaim` text is *always*
 * re-derived here from `METHOD_REGISTRY` via `mustNotClaimFor` — there is no parameter this
 * function accepts that could substitute a different disclosure string. `n`/`window`/`label` are
 * accepted as optional display hints (the caller's own `AxisMetric` already carries them, from
 * `get_ticker_sentiment` etc.) purely so the card can show the same n/window a host already saw
 * without a second round trip — but their **labels** ("Sample size (n):", "Window:") are always
 * emitted, and when a hint is omitted the value renders as the literal text "not supplied", never
 * a silently missing line. A component that renders a value with no n/window/disclosure line at
 * all is the build failure §4.4/§6 DoD name; a line that honestly says "not supplied" is not that
 * failure — a line that is *absent* is.
 */
import { loadArtifact, METHOD_REGISTRY } from '@/services/calculations';
import { mustNotClaimFor } from '../must-not-claim';
import { escapeHtml, htmlDocument } from './render';

export type MetricCardParams = {
  readonly calculationId: string;
  readonly n?: number | null;
  readonly window?: string | null;
  readonly label?: string | null;
};

export class MetricCardNotFoundError extends Error {}

export async function renderMetricCard(params: MetricCardParams): Promise<string> {
  const artifact = await loadArtifact(params.calculationId);
  if (artifact === null) {
    throw new MetricCardNotFoundError(`No calculation is on record for id '${params.calculationId}'.`);
  }

  let entry;
  try {
    entry = METHOD_REGISTRY.get(artifact.methodId, artifact.methodVersion);
  } catch {
    entry = null;
  }

  const claim = entry === null ? { tier: 'undisclosed' as const, lines: ['This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.'] } : mustNotClaimFor(entry);

  const label = params.label ?? entry?.title ?? artifact.methodId;
  const nText = params.n === undefined || params.n === null ? 'not supplied' : String(params.n);
  const windowText = params.window === undefined || params.window === null ? 'not supplied' : params.window;

  const valueText =
    artifact.result === null
      ? `abstained — ${artifact.abstention?.message ?? artifact.eligibility}`
      : `${artifact.result.display} ${artifact.result.unit}`;

  const disclosureHtml =
    claim.tier === 'd4'
      ? `<p data-role="tier-d4-record">${claim.lines.map((line) => escapeHtml(line)).join(' ')}</p>`
      : `<p data-role="tier-d-disclosure">${escapeHtml(claim.lines[0])}</p>`;

  const limitationsHtml =
    entry === null
      ? ''
      : `<ul data-role="limitations">${entry.limitations.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;

  const body = `
    <section data-role="metric-card" data-calculation-id="${escapeHtml(artifact.calculationId)}" data-method-id="${escapeHtml(artifact.methodId)}">
      <h2 data-role="label">${escapeHtml(label)}</h2>
      <p data-role="value">${escapeHtml(valueText)}</p>
      <p data-role="n">Sample size (n): ${escapeHtml(nText)}</p>
      <p data-role="window">Window: ${escapeHtml(windowText)}</p>
      ${disclosureHtml}
      ${limitationsHtml}
      <p data-role="method-version">${escapeHtml(artifact.methodId)}@${escapeHtml(artifact.methodVersion)}</p>
    </section>`;

  return htmlDocument(`Metric card — ${label}`, body);
}
