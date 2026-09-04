/**
 * `ui://inspector` (F21 §4.4) — "The `CalculationArtifact`: inputs, ordered steps, exact decimal,
 * rounding rule, hashes." The same real artifact `open_calculation` returns, rendered rather than
 * returned as JSON — no second computation, no second read path.
 *
 * §6 DoD's blanket phrasing ("all three `ui://` components render their own `n`, window,
 * coverage floor and disclosure") does not map onto a single artifact quite the way it maps onto
 * a sampled metric — a `CalculationArtifact` has no `n`/coverage-floor field of its own. Rather
 * than omit the lines, this renders the honest equivalents: `n` as the artifact's own recorded
 * input count (what it *did* have to work with), window as `asOf` (already required), and the
 * coverage-floor line names `get_coverage` as the tool to call for the axis's real floor rather
 * than fabricating one here — never a silently missing line.
 */
import { loadArtifact, METHOD_REGISTRY } from '@/services/calculations';
import { mustNotClaimFor } from '../must-not-claim';
import { escapeHtml, htmlDocument } from './render';

export class InspectorNotFoundError extends Error {}

export async function renderInspector(calculationId: string): Promise<string> {
  const artifact = await loadArtifact(calculationId);
  if (artifact === null) {
    throw new InspectorNotFoundError(`No calculation is on record for id '${calculationId}'.`);
  }

  const inputsHtml = artifact.inputs
    .map(
      (input) => `
      <li data-role="input" data-key="${escapeHtml(input.key)}">
        <span data-role="key">${escapeHtml(input.key)}</span>
        <span data-role="value">${escapeHtml(input.value)}</span>
        <span data-role="provider">${escapeHtml(input.provenance.provider ?? 'internal')}</span>
        <span data-role="observed-at">${escapeHtml(input.provenance.observedAt ?? 'unknown')}</span>
      </li>`,
    )
    .join('');

  const stepsHtml = artifact.steps
    .map(
      (step) => `
      <li data-role="step" data-key="${escapeHtml(step.key)}" data-status="${escapeHtml(step.status)}">
        <span data-role="label">${escapeHtml(step.label)}</span>
        <span data-role="formula">${escapeHtml(step.expression)}</span>
        <span data-role="substituted">${escapeHtml(step.substituted)}</span>
        <span data-role="exact">${escapeHtml(step.exactValue)}</span>
        <span data-role="display">${escapeHtml(step.displayValue)}</span>
        <span data-role="rounding-rule">${escapeHtml(step.roundingRule)}</span>
      </li>`,
    )
    .join('');

  const resultHtml =
    artifact.result === null
      ? `<p data-role="abstention">Abstained (${escapeHtml(artifact.eligibility)}): ${escapeHtml(artifact.abstention?.message ?? '')}</p>`
      : `
        <p data-role="result-exact">Exact: ${escapeHtml(artifact.result.exact)}</p>
        <p data-role="result-display">Display: ${escapeHtml(artifact.result.display)} ${escapeHtml(artifact.result.unit)}</p>
        <p data-role="rounding-rule">Rounding rule: ${escapeHtml(artifact.result.roundingRule)}</p>`;

  let entry;
  try {
    entry = METHOD_REGISTRY.get(artifact.methodId, artifact.methodVersion);
  } catch {
    entry = null;
  }
  const claim = entry === null
    ? ['This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.']
    : mustNotClaimFor(entry).lines;

  const body = `
    <section data-role="inspector" data-calculation-id="${escapeHtml(artifact.calculationId)}">
      <h2 data-role="label">${escapeHtml(artifact.methodId)}@${escapeHtml(artifact.methodVersion)}</h2>
      <p data-role="n">Sample size (n): ${escapeHtml(String(artifact.inputs.length))} recorded input(s) — see Inputs below for what each one was</p>
      <p data-role="window">Window (as of): ${escapeHtml(artifact.asOf)}</p>
      <p data-role="coverage-floor">This artifact is one computation, not a coverage view — call get_coverage for the real collector start date and gaps behind its axis.</p>
      <p data-role="tier-d-disclosure">${claim.map((line) => escapeHtml(line)).join(' ')}</p>
      <p data-role="input-hash">Input hash: ${escapeHtml(artifact.inputHash)}</p>
      <p data-role="result-hash">Result hash: ${escapeHtml(artifact.resultHash)}</p>
      ${resultHtml}
      <h3>Inputs</h3>
      <ul data-role="inputs">${inputsHtml}</ul>
      <h3>Steps</h3>
      <ol data-role="steps">${stepsHtml}</ol>
    </section>`;

  return htmlDocument(`Inspector — ${artifact.methodId}`, body);
}
