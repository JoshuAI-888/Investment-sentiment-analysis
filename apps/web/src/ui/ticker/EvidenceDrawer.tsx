/**
 * F09 §4.3 — the evidence drawer. "Opens from any evidence-backed element." Implemented as a
 * native `<details>` disclosure — keyboard-operable and screen-reader-exposed with no client JS
 * — rather than a bespoke modal; every axis panel above links evidence conceptually to this one
 * drawer per security (F09 does not scope evidence per-axis in its stored data — `evidence_item`
 * has no column tying a row to one particular rendered axis).
 *
 * **F-19 (link rot).** An item whose `availability !== 'available'` still renders its stored
 * snippet, with the honest marker — never blank, never silently dropped, and the link is still
 * shown. Availability is never repaired in place here (F-19).
 *
 * **Retrieved vs. used, per §4.3:** "The drawer states how many items were retrieved and how
 * many were used, so a user can see the filtering rather than infer it."
 */
import type { EvidenceDrawerView, EvidenceItemView } from './types';

export type EvidenceDrawerProps = { readonly evidence: EvidenceDrawerView };

function formatDate(value: Date | null): string {
  return value === null ? 'unknown' : value.toISOString();
}

function EvidenceRow({ item }: { readonly item: EvidenceItemView }) {
  return (
    <li
      className="border-t border-neutral-200 py-3 first:border-t-0"
      data-evidence-item={item.id}
      data-evidence-availability={item.availability}
      data-dedupe-key={item.dedupeKey}
    >
      <p className="text-sm font-semibold">{item.title}</p>
      <p className="text-xs text-neutral-500">
        {item.sourceKind} · {item.publisher ?? item.provider}
        {item.relevance === null ? '' : ` · relevance ${item.relevance}`}
      </p>
      <p className="text-xs text-neutral-500">
        published {formatDate(item.publishedAt)} · retrieved {formatDate(item.retrievedAt)}
      </p>

      {item.unreachableNote === null ? (
        <p className="mt-1 text-sm text-neutral-700" data-evidence-snippet="">
          {item.snippet ?? 'No snippet was retained.'}
        </p>
      ) : (
        <p className="mt-1 text-sm text-neutral-700" data-evidence-snippet="" data-evidence-unreachable="">
          {item.snippet ?? 'No snippet was retained.'}
          <span className="mt-1 block text-xs font-medium text-amber-700">{item.unreachableNote}</span>
        </p>
      )}

      {item.url === null ? null : (
        <a className="mt-1 inline-block text-xs underline decoration-dotted" href={item.url}>
          Open source
        </a>
      )}
    </li>
  );
}

export function EvidenceDrawer({ evidence }: EvidenceDrawerProps) {
  return (
    <details className="rounded border border-neutral-200 p-6" data-evidence-drawer="">
      <summary className="cursor-pointer text-lg font-semibold" data-evidence-summary="">
        Evidence (retrieved {evidence.retrievedCount}, used {evidence.usedCount})
      </summary>

      {evidence.truncated ? (
        <p className="mt-2 text-xs text-amber-700" data-evidence-truncated="">
          This security has more evidence than one scan window covers — the counts above are a
          lower bound, not an exact total.
        </p>
      ) : null}

      {evidence.pageTruncated ? (
        <p className="mt-2 text-xs text-amber-700" data-evidence-page-truncated="">
          More distinct evidence exists than is shown here — every axis below is drawn from this
          same capped page, so a heavily-covered security's stance and news counts may
          understate what is actually on record.
        </p>
      ) : null}

      {evidence.items.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-700">No evidence is on record for this security yet.</p>
      ) : (
        <ul className="mt-2">
          {evidence.items.map((item) => (
            <EvidenceRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </details>
  );
}
