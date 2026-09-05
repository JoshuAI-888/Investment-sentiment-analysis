/**
 * Substack feed items arrive as `content:encoded` HTML. Two consumers need plain text from it:
 * `attribute.ts`, which runs F10's deterministic mention detection over the prose, and the
 * scoring queue, whose pinned FinBERT checkpoint was trained on prose, not markup.
 *
 * **This is a text extractor, not a sanitizer, and the distinction is load-bearing.** The output
 * is never rendered as HTML anywhere — it is matched against a lexicon, stored in
 * `evidence_item.snippet`, and handed to a scorer. Treating this as a security boundary would
 * be the wrong claim to make about it: the boundary is that nothing downstream interprets the
 * result as markup. `<script>` and `<style>` contents are dropped anyway, because their bodies
 * are not prose and would otherwise pollute both the lexicon match and the score.
 *
 * Deliberately dependency-free. A DOM parser would be the general answer, but the input here is
 * one publisher's own generated markup, the failure mode of a regex extractor is degraded text
 * rather than a wrong attribution (a mangled tag leaves a token that matches no security), and
 * adding a parser to the collector's dependency set is a cost paid on every cold start of the
 * one path D-16 says must never stop running.
 */

/** Block-level tags whose boundaries are real sentence breaks, not incidental markup. */
const BLOCK_TAGS =
  /<\/?(?:p|div|br|li|ul|ol|h[1-6]|blockquote|pre|tr|td|th|table|section|article|header|footer|figure|figcaption|hr)\b[^>]*>/gi;

/** Element bodies that are not prose. Non-greedy, and tolerant of attributes on the open tag. */
const NON_PROSE_ELEMENTS = /<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** A minimal named-entity set: the ones Substack's own generator actually emits. */
const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['&amp;', '&'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&apos;', "'"],
  ['&nbsp;', ' '],
  ['&mdash;', '—'],
  ['&ndash;', '–'],
  ['&hellip;', '…'],
  ['&rsquo;', '’'],
  ['&lsquo;', '‘'],
  ['&rdquo;', '”'],
  ['&ldquo;', '“'],
]);

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => codePointOrEmpty(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => codePointOrEmpty(Number(dec)))
    .replace(/&[a-z]+;/gi, (entity) => NAMED_ENTITIES.get(entity.toLowerCase()) ?? entity);
}

/**
 * A numeric entity outside Unicode's range, or in the surrogate block, is dropped rather than
 * thrown on: `String.fromCodePoint` throws a `RangeError` on both, and one malformed entity in
 * one post must not fail a whole publication's poll under D-16's forward-only clock.
 */
function codePointOrEmpty(code: number): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return '';
  if (code >= 0xd800 && code <= 0xdfff) return '';
  return String.fromCodePoint(code);
}

/**
 * HTML → plain text. Block boundaries become spaces, so two words either side of a `</p><p>`
 * do not fuse into one token that matches nothing.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(NON_PROSE_ELEMENTS, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(BLOCK_TAGS, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}
