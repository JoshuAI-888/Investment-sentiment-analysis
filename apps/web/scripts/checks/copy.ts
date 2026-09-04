import type { Finding } from './types';
import type { RegisteredMethod } from './calc-coverage';

/**
 * check:copy — F01 §4.4, extended by D-09.
 *
 * `05-TEST-STRATEGY.md` §201 calls this "a plain source scan: banned vocabulary anywhere in
 * user-facing strings; the §6.4 disclosure line present wherever a divergence state renders."
 * D-09 adds the third clause: predictive vocabulary on a metric with no Tier D4 record fails
 * the build. That clause reads the method registry rather than judging prose, which is what
 * makes it a check rather than an opinion.
 *
 * F19 §4.3 fills it out. What ships here is the mechanism and its failing-case tests.
 */

/** Verbatim, from product invariant §6.4. Changing a character of this is changing the promise. */
export const DISCLOSURE_LINE =
  'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.';

/**
 * F01 §4.4's list, extended by F08 §4.2's own two additions ("Reddit-wide", "retail sentiment" —
 * round-25 lane-review finding 3: F08 §4.2 states outright that the copy lint enforces all four
 * of "all Reddit", "Reddit-wide", "retail sentiment" and "consensus," but only the first and last
 * were actually here; `tests/e2e/attention.spec.ts` kept its own separate, complete four-word DOM
 * scan, covering only `/social/reddit`'s own seeded states — this shared, repo-wide mechanism is
 * what F08's spec text claims backs the promise everywhere else a divergence state might render).
 * Banned unconditionally — passing Tier D4 never licenses any of these.
 */
const BANNED_VOCABULARY: readonly string[] = [
  'signal',
  'strong buy',
  'risk-on',
  'consensus',
  'Reddit sentiment',
  'all Reddit',
  'Reddit-wide',
  'retail sentiment',
  'live X sentiment',
  'guaranteed',
  'will outperform',
];

/**
 * D-09. Allowed only on a metric that carries a Tier D4 record, and then only alongside its
 * IC, t-statistic, sample period and backtest link.
 */
const PREDICTIVE_VOCABULARY: readonly string[] = [
  'forecast',
  'predicts',
  'predicted',
  'expected return',
  'probability',
  'outperform',
  'underperform',
  'price target',
  'target price',
];

export type SourceFile = { readonly path: string; readonly content: string };

export type CopyInput = {
  readonly files: readonly SourceFile[];
  /** F05's registry. Empty until it lands, which is why the D4 clause passes on empty. */
  readonly methods: readonly RegisteredMethod[];
};

/**
 * Strips `//` and `/* *&#47;` comments before either extraction pass below runs, without
 * disturbing a string literal that merely contains comment-like text (a URL's `//`, a doc
 * comment's own backtick-quoted identifier). Round-14 lane-review finding 4: widening this
 * check's scan roots onto `src/services/attention/leaderboard.ts` — a file whose extensive
 * prose doc comments quote identifiers in backticks (`` `FreshnessBadge` ``) — turned every such
 * backtick pair into a fake string literal under the naive quoted-literal regex below, and a
 * plain English word inside an ordinary `//` comment (`guaranteed`) into fabricated "banned
 * vocabulary" findings. A small string-aware scan (tracking whether each character sits inside a
 * quote, and only then recognizing `//`/`/*` as a comment) is what a real user-facing string
 * scanner needs regardless of which directories get added to it later — this is not specific to
 * one file, since any comment using backticks or unbalanced quotes would have hit it.
 *
 * **Two failure modes of that same naive approach — round-15 lane-review finding 1.** Neither is
 * hit by anything in today's scan roots (diffed every extracted string old-vs-new across all 77
 * files; nothing changed), but both are silent narrowings of the gate for whatever gets added
 * next, which is exactly the failure mode this check exists to not have.
 *
 * (a) `//` inside bare JSX text that is not itself a quoted string — `&lt;p&gt;See https://x.io/ — the
 * consensus view&lt;/p&gt;` — has no quote characters at all before the `//` in `https://`, so the
 * scanner above (which only recognizes `'`/`"`/`` ` `` as a string boundary) would treat it as a
 * comment opener and silently drop the rest of that line, "consensus" included. Guarded here by
 * refusing to treat `//` as a comment when the character right before it is `:` — virtually every
 * `//` preceded by a colon in real source is a URL scheme, and a genuine line comment is never
 * preceded by one.
 *
 * (b) An unterminated `/*` — real code never leaves one open, but bare JSX text can contain a
 * literal `/*` with no comment intent at all (`&lt;p&gt;Rating: 4/*5 stars&lt;/p&gt;`) — searched for its
 * closer with `indexOf('*&#47;', …)`, and on a miss (returns -1) the original version jumped `i` to
 * `content.length`, silently discarding every string and JSX text node in the rest of the file
 * while still printing `pass`. Treated here as *not* a comment at all when unterminated: the `/*`
 * is copied through literally and scanning resumes right after it, so nothing later in the file is
 * lost. This does not fully solve JSX text that happens to contain `/*` when the file separately
 * contains a real, later block comment (an unrelated `*&#47;` would still close it) — a narrower,
 * bounded residual risk, not a whole-file one.
 *
 * **Two more classes, found but not fixed — round-16 lane-review finding 2.** This scanner has no
 * concept of TS/JSX lexical state — only "inside a quote or not" — so it also misses:
 *
 * (c) A template literal's `${…}` interpolation. `` `${cond ? `A strong buy today` : ''} ok` ``:
 * the outer backtick's own scan closes on the *first* subsequent backtick, which is the nested
 * literal's opening one, not its closing one — the actual copy inside `${…}` never becomes an
 * extracted string at all.
 *
 * (d) A regex literal. `` /'/g `` contains a bare `'` with no string intent; the scanner opens a
 * phantom string on it and consumes everything up to the *next* `'` in the file — which is very
 * often the opening quote of the next real string literal, silently merging the two and losing
 * the real one's content.
 *
 * Both are accepted, documented residuals rather than fixed: nothing in today's scan roots hits
 * either (checked directly, the same way (a) and (b) were), and closing them for real needs an
 * actual lexer for TS/JSX lexical state, not another special case in a hand-rolled character
 * scanner — the `:`-before-`//` guard above is a fix for the one shape it names, not a structural
 * fix, and three rounds of finding a new shape this scanner mishandles is itself evidence that the
 * approach has a ceiling. `extractUserFacingStrings`'s own doc below already accepts a comparable
 * false-negative tradeoff for the regex-based approach as a whole (a raw scan would flag
 * `AbortSignal` as the banned word "signal", so the mechanism is built to under-report rather than
 * over-report); this is the same kind of tradeoff, not a new kind. If a future round adds a scan
 * root where (c) or (d) actually fires, the fix is to lex with TypeScript's own compiler API
 * (already a workspace dependency) rather than to patch this function a fourth time.
 */
function stripComments(content: string): string {
  let result = '';
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < content.length) {
        if (content[j] === '\\') {
          j += 2;
          continue;
        }
        if (content[j] === ch) {
          j += 1;
          break;
        }
        j += 1;
      }
      result += content.slice(i, j);
      i = j;
      continue;
    }
    if (content.startsWith('//', i) && content[i - 1] !== ':') {
      const end = content.indexOf('\n', i);
      i = end === -1 ? content.length : end;
      continue;
    }
    if (content.startsWith('/*', i)) {
      const end = content.indexOf('*/', i + 2);
      if (end === -1) {
        // Unterminated: not a real comment. Copy the two characters through literally rather
        // than discarding the rest of the file.
        result += content.slice(i, i + 2);
        i += 2;
        continue;
      }
      i = end + 2;
      continue;
    }
    result += ch;
    i += 1;
  }
  return result;
}

/**
 * User-facing strings only: quoted literals and JSX text. Scanning raw source instead would
 * report `AbortSignal` as the banned word "signal" on the first PR and be switched off on
 * the second.
 */
export function extractUserFacingStrings(rawContent: string): string[] {
  const strings: string[] = [];
  const content = stripComments(rawContent);

  const literals = content.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g);
  for (const match of literals) {
    const value = match[2];
    if (value !== undefined && value.trim() !== '') strings.push(value);
  }

  // JSX text: what sits between a closing `>` and the next opening `<`.
  const jsxText = content.matchAll(/>([^<>{}]+)</g);
  for (const match of jsxText) {
    const value = match[1];
    if (value !== undefined && value.trim() !== '') strings.push(value);
  }

  return strings;
}

/** `data-metric="attention.rank_change"` — the structural anchor tying copy to a metric. */
export function metricsReferencedIn(content: string): string[] {
  return [...content.matchAll(/data-metric=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((id): id is string => id !== undefined);
}

function contains(haystack: string, needle: string): boolean {
  return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack);
}

/**
 * D-RNI-03 requires this exact three-section heading. The legacy ban prevents prose from
 * presenting a sample as platform-wide sentiment, so the exception is deliberately narrower:
 * only the standalone heading in an RNI-owned surface is allowed. A sentence such as
 * "Reddit sentiment is bullish" still fails and must name the observed sample.
 */
function isRniRequiredHeading(file: SourceFile, value: string, banned: string): boolean {
  if (banned !== 'Reddit sentiment') return false;
  if (!/(?:^|[/\\])(?:app[/\\]\(rni\)|src[/\\]rni[/\\]ui)(?:[/\\]|$)/u.test(file.path)) {
    return false;
  }
  return value.trim().toLowerCase() === 'reddit sentiment';
}

/** A file renders a divergence state if it names one structurally. */
function rendersDivergenceState(content: string): boolean {
  return /divergence/i.test(content);
}

export function checkCopy(input: CopyInput): Finding[] {
  const findings: Finding[] = [];
  const byId = new Map(input.methods.map((method) => [method.id, method]));

  for (const file of input.files) {
    const strings = extractUserFacingStrings(file.content);

    for (const banned of BANNED_VOCABULARY) {
      const hit = strings.find((value) => contains(value, banned));
      if (hit === undefined) continue;
      if (isRniRequiredHeading(file, hit, banned)) continue;
      findings.push({
        check: 'copy',
        where: `${file.path} — "${banned}"`,
        message: `is banned in user-facing copy (product invariant §6.4). Found in: "${hit.trim().slice(0, 120)}". Use "state" or "pattern" for "signal"; name the sampling frame instead of implying a census.`,
      });
    }

    if (rendersDivergenceState(file.content) && !file.content.includes(DISCLOSURE_LINE)) {
      findings.push({
        check: 'copy',
        where: `${file.path} — divergence state`,
        message: `renders a divergence state without the §6.4 disclosure line verbatim. It must read exactly: "${DISCLOSURE_LINE}"`,
      });
    }

    // D-09's clause. An unknown metric id is check:calc-coverage's finding, not this one's —
    // one defect reported by two checks is one defect fixed twice and understood once.
    const referenced = metricsReferencedIn(file.content);
    for (const predictive of PREDICTIVE_VOCABULARY) {
      const hit = strings.find((value) => contains(value, predictive));
      if (hit === undefined) continue;

      for (const metricId of referenced) {
        const method = byId.get(metricId);
        if (method === undefined) continue;
        if (method.tierD4Record !== undefined) continue;

        findings.push({
          check: 'copy',
          where: `${file.path} — "${predictive}" on metric '${metricId}'`,
          message: `is predictive vocabulary attached to a metric with no Tier D4 record (D-09). A metric that has not passed D4 carries the §6.4 disclosure and makes no claim about returns; a claim without the record is a build failure, not a copy choice.`,
        });
      }
    }
  }

  return findings;
}
