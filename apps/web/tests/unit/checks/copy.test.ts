import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkCopy, DISCLOSURE_LINE, extractUserFacingStrings } from '../../../scripts/checks/copy';

const WEB_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const clean = { path: 'app/(app)/dashboard/page.tsx', content: '<p>Observed Reddit sample</p>' };

describe('check:copy — banned vocabulary', () => {
  it('passes on clean copy', () => {
    expect(checkCopy({ files: [clean], methods: [] })).toEqual([]);
  });

  // CAN FAIL — F01 §5's "seeded banned word".
  it('fails on "signal" in user-facing copy', () => {
    const findings = checkCopy({
      files: [{ path: 'app/page.tsx', content: '<p>A bullish signal on NVDA</p>' }],
      methods: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.where).toContain('signal');
  });

  it.each([
    'strong buy',
    'risk-on',
    'consensus',
    'all Reddit',
    'guaranteed',
    'will outperform',
    // Round-25 lane-review finding 3: F08 §4.2 states these two, alongside "all Reddit" and
    // "consensus" above, are enforced by this lint — only the other two actually were.
    'Reddit-wide',
    'retail sentiment',
  ])('fails on "%s"', (banned) => {
    const findings = checkCopy({
      files: [{ path: 'app/page.tsx', content: `<p>Market is ${banned} today</p>` }],
      methods: [],
    });
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  it('does not report a banned word appearing only as an identifier', () => {
    // `AbortSignal` is not copy. A scan that cannot tell the difference gets disabled.
    const findings = checkCopy({
      files: [{ path: 'src/ui/Fetch.tsx', content: 'const controller=new AbortController();const signal=controller.signal;' }],
      methods: [],
    });
    expect(findings).toEqual([]);
  });

  // Round-14 lane-review finding 4. `src/services/attention/leaderboard.ts`'s own prose doc
  // comments quote identifiers in backticks (`` `AttentionTable` ``) and use ordinary English
  // contractions/possessives with stray apostrophes ("it is `del`'d only at the end") — once this
  // file entered `check-copy.ts`'s scan, the naive quoted-literal regex opened a "string" on one
  // of those stray delimiters and did not close it until some unrelated later quote elsewhere in
  // the file, dragging plain comment prose (including the words "signal" and "guaranteed") into
  // what the check treated as a real quoted user-facing string. Scanning the actual file directly
  // — not a hand-built excerpt — is what proves the fix against the exact prose that broke it,
  // since reconstructing the precise stray-quote chain by hand had already once produced a
  // synthetic case too small to reproduce the bug.
  it('reports nothing on the real leaderboard.ts source, despite its prose doc comments\' stray backticks and apostrophes', () => {
    const content = readFileSync(path.join(WEB_ROOT, 'src/services/attention/leaderboard.ts'), 'utf8');
    const findings = checkCopy({ files: [{ path: 'src/services/attention/leaderboard.ts', content }], methods: [] });
    expect(findings).toEqual([]);
  });

  it('still reports a banned word in a real string literal that follows a comment on the same file', () => {
    const findings = checkCopy({
      files: [
        {
          path: 'src/services/attention/leaderboard.ts',
          content: "// a harmless comment\nconst copy = 'This is a strong buy right now';",
        },
      ],
      methods: [],
    });
    expect(findings).toHaveLength(1);
  });

  // Round-15 lane-review finding 1(a). Bare JSX text containing a URL has no quote characters
  // at all before the URL's own "//" — a naive comment-stripper with no notion of "inside a
  // string" would treat that "//" as a line-comment opener and silently drop the rest of the
  // line, banned word included. `stripComments` refuses to treat "//" as a comment when the
  // character right before it is ":", which is true of every URL scheme and false of a genuine
  // line comment.
  it('still finds a banned word on the same line as a bare URL in JSX text', () => {
    const findings = checkCopy({
      files: [{ path: 'app/page.tsx', content: '<p>See https://apewisdom.io/ — the consensus view</p>' }],
      methods: [],
    });
    expect(findings.some((finding) => finding.where.includes('consensus'))).toBe(true);
  });

  // Round-15 lane-review finding 1(b). Bare JSX text can contain a literal "/*" with no comment
  // intent (`4/*5 stars`). The original `stripComments` searched for a closing "*/" and, on a
  // miss, jumped straight to `content.length` — silently discarding every string and JSX text
  // node in the rest of the file while `check:copy` still printed "pass". An unterminated `/*`
  // is now left in place rather than treated as an open comment, so nothing after it is lost.
  it('still finds a banned word later in the file after an unterminated /* in JSX text', () => {
    const findings = checkCopy({
      files: [{ path: 'app/page.tsx', content: '<p>Rating: 4/*5 stars</p>\n<p>A bullish signal on NVDA</p>' }],
      methods: [],
    });
    expect(findings.some((finding) => finding.where.includes('signal'))).toBe(true);
  });
});

describe('check:copy — the §6.4 disclosure line', () => {
  it('passes when a divergence state carries the line verbatim', () => {
    const findings = checkCopy({
      files: [
        {
          path: 'src/ui/Divergence.tsx',
          content: `export const Divergence = () => <p>{'${DISCLOSURE_LINE}'}</p>;`,
        },
      ],
      methods: [],
    });
    expect(findings).toEqual([]);
  });

  // CAN FAIL.
  it('fails when a divergence state omits the line', () => {
    const findings = checkCopy({
      files: [{ path: 'src/ui/Divergence.tsx', content: 'export const Divergence = () => <p>Diverging</p>;' }],
      methods: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('disclosure line');
  });

  it('fails when the line is paraphrased rather than verbatim', () => {
    const findings = checkCopy({
      files: [
        {
          path: 'src/ui/Divergence.tsx',
          content: "export const Divergence = () => <p>{'This describes what is observable and is not a forecast.'}</p>;",
        },
      ],
      methods: [],
    });
    expect(findings).toHaveLength(1);
  });
});

describe('check:copy — D-09 Tier D4 clause', () => {
  const predictiveCopy = {
    path: 'app/(app)/ticker/page.tsx',
    content: '<span data-metric="attention.rank_change">Historically this predicts a move</span>',
  };

  it('passes on empty — the registry is F05’s and does not exist yet', () => {
    expect(checkCopy({ files: [predictiveCopy], methods: [] })).toEqual([]);
  });

  // CAN FAIL — D-09's clause, which F01's DoD names explicitly.
  it('fails on predictive vocabulary attached to a metric with no Tier D4 record', () => {
    const findings = checkCopy({
      files: [predictiveCopy],
      methods: [{ id: 'attention.rank_change', goldens: ['g.json'] }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('no Tier D4 record');
  });

  it('passes once the metric carries a Tier D4 record', () => {
    const findings = checkCopy({
      files: [predictiveCopy],
      methods: [
        { id: 'attention.rank_change', goldens: ['g.json'], tierD4Record: 'backtest/2026-08-rank-change' },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('leaves an unknown metric id to check:calc-coverage', () => {
    const findings = checkCopy({
      files: [predictiveCopy],
      methods: [{ id: 'something.else', goldens: ['g.json'] }],
    });
    expect(findings).toEqual([]);
  });
});

describe('extractUserFacingStrings', () => {
  it('pulls quoted literals and JSX text, and skips whitespace', () => {
    const strings = extractUserFacingStrings(`const a = 'hello';\n<p>world</p>\n<div>   </div>`);
    expect(strings).toContain('hello');
    expect(strings).toContain('world');
    expect(strings.every((value) => value.trim() !== '')).toBe(true);
  });
});
