/**
 * `ui://evidence-list` (F21 §4.4) — "Bounded classified items, `availability` state, snippet as
 * retrieved." Same bounding as `list_supporting_evidence`/`list_contradicting_evidence`
 * (`../evidence-view.ts`) — this is the render of the same data, not a second source of it.
 */
import { resolveTickerSymbol } from '@/services/ticker/resolve';
import { boundedEvidenceFor, type StanceDirection } from '../evidence-view';
import { escapeHtml, htmlDocument } from './render';

export type EvidenceListParams = {
  readonly symbol: string;
  readonly direction: StanceDirection;
};

export class EvidenceListNotFoundError extends Error {}

export async function renderEvidenceList(params: EvidenceListParams): Promise<string> {
  const asOf = new Date();
  const resolved = await resolveTickerSymbol(params.symbol, asOf);
  if (!resolved.ok) throw new EvidenceListNotFoundError(resolved.refusal.message);

  const bounded = await boundedEvidenceFor(resolved.security.id, params.direction, asOf, null);

  const itemsHtml = bounded.items
    .map(
      (item) => `
      <li data-role="evidence-item" data-id="${escapeHtml(item.id)}" data-availability="${escapeHtml(item.availability)}">
        <span data-role="title">${escapeHtml(item.title)}</span>
        <span data-role="provider">${escapeHtml(item.provider)}</span>
        <span data-role="stance">${escapeHtml(item.stanceLabel ?? 'unclear')}</span>
        <span data-role="retrieved-at">${escapeHtml(item.retrievedAt)}</span>
        <p data-role="snippet">${escapeHtml(item.snippet ?? '')}</p>
      </li>`,
    )
    .join('');

  const body = `
    <section data-role="evidence-list" data-security-id="${escapeHtml(resolved.security.id)}" data-direction="${escapeHtml(params.direction)}">
      <h2 data-role="label">${escapeHtml(resolved.security.symbol)} — ${escapeHtml(params.direction)} evidence</h2>
      <p data-role="n">Sample size (n): ${escapeHtml(String(bounded.usedCount))}</p>
      <p data-role="retrieved-count">Retrieved: ${escapeHtml(String(bounded.retrievedCount))}</p>
      <p data-role="bound-disclosure">This list is bounded and stance-classified. It is never the full evidence corpus for this security.</p>
      ${bounded.truncated ? '<p data-role="truncated">More classified items existed than fit this bounded list.</p>' : ''}
      <ul data-role="items">${itemsHtml}</ul>
    </section>`;

  return htmlDocument(`Evidence — ${resolved.security.symbol}`, body);
}
