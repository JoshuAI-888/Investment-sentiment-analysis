import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  INSPECTOR_SECTIONS,
  inspectorHref,
  parsePointIndex,
} from '../../../src/ui/inspector-links';
import { methods as DESCRIPTORS } from '../../../src/analytics/registry';
import { checkCalcCoverage } from '../../../scripts/checks/calc-coverage';
import { loadMetricManifest, loadRegistry } from '../../../scripts/checks/load';

const WEB_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (relative: string) => readFile(path.join(WEB_ROOT, relative), 'utf8');

const INSPECTOR = 'src/ui/CalculationInspector.tsx';
const METRIC = 'src/ui/InspectableMetric.tsx';

/**
 * Comments removed. The rule §8 states is about the *code* — a doc comment that explains why no
 * method may be named here has to be able to name one, or the explanation is unreadable.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

describe('F-07 — addressing a value and a point of a series', () => {
  it('links a scalar to its artifact', () => {
    expect(inspectorHref('abc')).toBe('/calculations/abc');
  });

  it('addresses a chart point as {calculationId, pointIndex}', () => {
    // The whole of F-07's ruling as a URL: a 180-point series is one artifact, and a point is
    // resolved out of it rather than being an artifact of its own.
    expect(inspectorHref('abc', 7)).toBe('/calculations/abc?point=7');
    expect(parsePointIndex('7')).toBe(7);
    expect(parsePointIndex('0')).toBe(0);
  });

  it('ignores a point parameter that is not a point, rather than guessing', () => {
    for (const raw of [undefined, '', 'x', '-1', '1.5', '1e3']) {
      expect(parsePointIndex(raw), String(raw)).toBeNull();
    }
  });

  it('escapes an identifier rather than pasting it into a URL', () => {
    expect(inspectorHref('a/b?c')).toBe('/calculations/a%2Fb%3Fc');
  });
});

describe('F05 §4.8 — the Inspector is generic across every method', () => {
  // This is a cheap, no-database source check that the seven sections are DECLARED — it reads
  // the `id` prop passed to each `<Section>` call, which IS what appears literally in source.
  // **It cannot prove they RENDER, and must never be read as though it does** — a render-time
  // throw ships green here. `Section` itself renders `data-inspector-section={props.id}`, not
  // a literal `id="..."` attribute, deliberately (this component renders twice per page — see
  // CalculationInspector.tsx) — that DOM attribute cannot be checked from source text at all.
  // The test that actually proves rendering, against a genuine Postgres-loaded artifact, is
  // `tests/integration/calculation-kernel.test.ts`'s "actually renders — not just names — all
  // seven sections for a real artifact", which needs a database and therefore cannot run here.
  // (Lane-review's second pass on F05 flagged this file as leaving that ambiguity unstated.)
  it('declares all seven sections in source — does not prove they render; see the integration test for that', async () => {
    const source = await read(INSPECTOR);
    for (const section of INSPECTOR_SECTIONS) {
      expect(source, `section '${section}' is missing`).toContain(`id="${section}"`);
    }
    expect(INSPECTOR_SECTIONS).toHaveLength(7);
  });

  // CAN FAIL — §8's reviewer check, made executable: "zero method names appear in the
  // Inspector's code". A section that special-cased one method would render nothing for the next.
  it('names no method, anywhere in its source', async () => {
    const sources = (await Promise.all([read(INSPECTOR), read(METRIC)])).map(stripComments);
    for (const source of sources) {
      for (const descriptor of DESCRIPTORS) {
        expect(source).not.toContain(descriptor.id);
        // Not the domain prefix either — `attention.` would be the first special case.
        expect(source).not.toContain(`${descriptor.id.split('.')[0]}.`);
      }
    }
  });

  it('reads its formula, bounds and limitations from the registry rather than from copy', async () => {
    const source = await read(INSPECTOR);
    for (const field of ['symbolicFormula', 'limitations', 'eligibilityRules', 'roundingRule']) {
      expect(source, field).toContain(`view.${field}`);
    }
  });

  it('renders the abstention reason where a number would be', async () => {
    // §7.5: "Open the Inspector on a `not_applicable` artifact — is the reason legible to a
    // non-engineer?" It can only be if the reason is rendered at all.
    const source = await read(INSPECTOR);
    expect(source).toContain('view.abstentionReason');
    expect(source).toContain('data-abstention');
  });

  it('never calls replay when the page opens', async () => {
    // §4.6: "Replay is an explicit validation action, never something that happens when a page
    // opens." Source §18.2's ruling, and the easiest one in this feature to lose to a
    // convenience.
    for (const file of [
      INSPECTOR,
      'src/services/inspector.ts',
      'app/(app)/calculations/[calculationId]/InspectorPage.tsx',
      'app/(app)/calculations/[calculationId]/page.tsx',
      'app/(app)/@calculationDrawer/(.)calculations/[calculationId]/page.tsx',
    ]) {
      const source = await read(file);
      expect(source, file).not.toMatch(/\brunReplay\s*\(/);
      expect(source, file).not.toMatch(/\breplay\s*\(/);
    }
  });

  it('is rendered by both the canonical page and the intercepted drawer, from one component', async () => {
    const canonical = await read('app/(app)/calculations/[calculationId]/page.tsx');
    const drawer = await read('app/(app)/@calculationDrawer/(.)calculations/[calculationId]/page.tsx');
    expect(canonical).toContain('InspectorPage');
    expect(drawer).toContain('InspectorPage');
    // The drawer must not claim to be the canonical page, or the e2e case that tells a hard
    // load apart from an interception cannot tell them apart.
    expect(drawer).not.toContain('data-route');
  });
});

describe('F05 §4.8 — InspectableMetric is the only path a value renders through', () => {
  it('requires a calculation id, so a number with nothing to resolve to cannot be rendered', async () => {
    const source = await read(METRIC);
    expect(source).toMatch(/readonly calculationId: string;/);
    expect(source).not.toMatch(/readonly calculationId\?: /);
    expect(source).toMatch(/readonly metricId: string;/);
  });

  it('always renders the link', async () => {
    const source = await read(METRIC);
    expect(source).toContain('inspectorHref(props.calculationId');
    // One anchor, outside both branches of the abstention conditional — so an abstaining value
    // links to its artifact exactly as a numeric one does.
    expect(source.match(/<a\b/g) ?? []).toHaveLength(1);
  });

  it('renders an abstention in words rather than as a zero or a dash', async () => {
    const source = await read(METRIC);
    expect(source).toContain('data-abstained');
    expect(source).toContain('No value —');
  });

  it('names the rounding rule beside the value', async () => {
    expect(await read(METRIC)).toContain('data-rounding-rule={props.roundingRule}');
  });
});

describe('F05 DoD — check:calc-coverage is no longer a stub', () => {
  it('loads a non-empty registry, so the check is no longer passing vacuously', async () => {
    // Until this file existed the check ran against zero methods and could not discriminate.
    // `scripts/checks/load.ts` reads `src/analytics/registry.ts` by path, unchanged since F01.
    const loaded = await loadRegistry();
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.map((method) => method.id)).toContain('attention.rank_change');
  });

  it('passes on what is actually shipped', async () => {
    const [methods, metrics] = await Promise.all([loadRegistry(), loadMetricManifest()]);
    expect(checkCalcCoverage({ methods, metrics })).toEqual([]);
  });

  // CAN FAIL — "it fails on a metric rendered without a registered method".
  it('fails on a metric rendered with no method, against the real registry', async () => {
    const methods = await loadRegistry();
    const findings = checkCalcCoverage({
      methods,
      metrics: [{ id: 'attention_rank', methodId: null, renderedIn: 'app/(app)/dashboard' }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('no registered method');
  });

  // CAN FAIL — and this one could not fail at all before the registry existed.
  it('fails on a metric naming a method the shipped registry does not have', async () => {
    const methods = await loadRegistry();
    const findings = checkCalcCoverage({
      methods,
      metrics: [
        // A plausible near-miss: the right method, spelled the way a developer would guess.
        { id: 'attention_rank', methodId: 'attention.rankChange', renderedIn: 'app/x' },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('not in the registry');
  });
});
