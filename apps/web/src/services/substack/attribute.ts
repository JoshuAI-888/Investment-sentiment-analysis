/**
 * Which securities a Substack post is about — the collection-time half of attribution.
 *
 * `evidence_item.security_id` is a single nullable column and `evidenceForSecurity` reads by it,
 * so a post that is never attributed is corpus nobody can retrieve for a ticker. Attribution
 * therefore has to happen at collection time, and it has to happen without an LLM: under D-16
 * collection is forward-only and must never stop, so putting a model call on the ingest path
 * would make the irreplaceable half of the system depend on the replaceable one.
 *
 * F10 §4.2's `detectMention` is exactly that no-LLM pass, and this module is a thin, deliberate
 * policy over its verdicts:
 *
 * | `detectMention` verdict | What happens here | Why |
 * |---|---|---|
 * | `cashtag` / `symbol` / `company_name` | **Attributed.** One `evidence_item` per (post, security) | The security is named outright. No semantic judgment is needed |
 * | `ambiguous`, `corroborated: true` | **Not attributed.** Recorded as a pending candidate | §4.4: whether "AI" in a post that also names the company is *about* that company is a semantic judgment a lexicon cannot make. Attributing it here would fabricate a match |
 * | `ambiguous`, `corroborated: false` | Dropped | Nothing corroborates the token. There is not even a question to ask |
 * | `none` | Dropped | The security is not named at all |
 *
 * **A post with no attributed security is still written, with `securityId: null`** — see
 * `collector.ts`. It is permanent corpus under D-17, and `entity.collision_guard` can resolve
 * its pending candidates later. Discarding it at ingest would be an unrecoverable decision made
 * by the cheapest stage in the pipeline.
 */
import type { Security } from '@/contracts/security';
import { detectMention, type MentionCandidate } from '@/services/evidence/candidates';

export type AttributedMatch = {
  readonly securityId: string;
  readonly symbol: string;
  /** The verdict that attributed it — carried into `metadata` so a row's basis is inspectable. */
  readonly basis: Extract<MentionCandidate, { kind: 'cashtag' | 'symbol' | 'company_name' }>;
};

export type PendingCandidate = {
  readonly securityId: string;
  readonly symbol: string;
  readonly token: string;
};

export type AttributionResult = {
  readonly matches: readonly AttributedMatch[];
  /**
   * Ambiguous-but-corroborated securities, in provider order. Not attributed, not discarded —
   * carried in the row's `metadata` so `entity.collision_guard` has something to resolve without
   * re-scanning the whole corpus.
   */
  readonly pending: readonly PendingCandidate[];
};

/**
 * `text` should be the title and body joined — a security named only in the headline is as
 * genuinely mentioned as one named in paragraph six, and `detectMention` has no notion of
 * position.
 */
export function attributeText(text: string, securities: readonly Security[]): AttributionResult {
  const matches: AttributedMatch[] = [];
  const pending: PendingCandidate[] = [];

  for (const security of securities) {
    const candidate = detectMention(text, {
      symbol: security.symbol,
      companyName: security.name,
      aliases: security.aliases,
    });

    switch (candidate.kind) {
      case 'cashtag':
      case 'symbol':
      case 'company_name':
        matches.push({ securityId: security.id, symbol: security.symbol, basis: candidate });
        break;
      case 'ambiguous':
        if (candidate.corroborated) {
          pending.push({ securityId: security.id, symbol: security.symbol, token: candidate.token });
        }
        break;
      case 'none':
        break;
    }
  }

  return { matches, pending };
}
