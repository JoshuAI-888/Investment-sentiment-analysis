/**
 * Loads and validates the frozen corpus (F12 §4.1) and seeded-error corpus (F12 §4.2) from
 * `fixtures/eval-corpus/` — mirrors `services/research/model-tasks.ts`'s own
 * `DEFAULT_RESEARCH_LLM_FIXTURES_ROOT` pattern: a `fixtures/` root under `process.cwd()`, read
 * with plain `readFile`, never bundled.
 *
 * **Frozen, per F12 §4.1: "regenerated only by a deliberate, reviewed PR that also re-labels
 * it."** Nothing in this module writes to `fixtures/eval-corpus/` — it only reads. The generator
 * that produced the committed files lives at `scripts/eval/generate-corpus.ts` and is not
 * imported from here or from any production path; running it again is exactly the "deliberate,
 * reviewed PR" this docstring's quote requires, never a build side effect.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { EvidencePack, IncludedItem, ExcludedItem } from '@/services/evidence';
import { evalCorpusPackMeta, seededErrorFile, type EvalCorpusPackMeta, type SeededErrorFile } from './schema';

export const CORPUS_VERSION = 'v1';

export const DEFAULT_CORPUS_ROOT = join(process.cwd(), 'fixtures', 'eval-corpus');

export type EvalCorpusPack = {
  readonly meta: EvalCorpusPackMeta;
  readonly pack: EvidencePack;
};

export class CorpusValidationError extends Error {
  constructor(path: string, reason: string) {
    super(`corpus fixture at '${path}' is invalid: ${reason}`);
    this.name = 'CorpusValidationError';
  }
}

/**
 * Structural validation against F10's real `EvidencePack` shape — not a second zod schema (this
 * module's own docstring on `evalCorpusPackMeta` explains why: two schemas for one type is a
 * "must be kept identical" trap). Checks exactly what this harness reads: the disclosure triple,
 * and that every item this file claims is `included`/`excluded` actually has the shape those
 * variants require.
 */
function assertIsEvidencePack(path: string, value: unknown): asserts value is EvidencePack {
  if (typeof value !== 'object' || value === null) {
    throw new CorpusValidationError(path, 'pack is not an object');
  }
  const pack = value as Partial<EvidencePack>;
  if (typeof pack.securityId !== 'string' || typeof pack.asOf !== 'string') {
    throw new CorpusValidationError(path, 'pack is missing securityId/asOf');
  }
  if (!Array.isArray(pack.items) || !Array.isArray(pack.excluded)) {
    throw new CorpusValidationError(path, 'pack.items/pack.excluded must be arrays');
  }
  if (!Array.isArray(pack.disclosures) || pack.disclosures.length !== 3) {
    throw new CorpusValidationError(path, 'pack.disclosures must carry exactly three axis disclosures (D-14)');
  }
  const axes = pack.disclosures.map((d) => (d as { axis?: unknown }).axis);
  if (axes[0] !== 'reddit' || axes[1] !== 'x' || axes[2] !== 'substack') {
    throw new CorpusValidationError(path, "pack.disclosures must be ordered [reddit, x, substack]");
  }
  for (const item of pack.items as IncludedItem[]) {
    if (item.kind !== 'included' || typeof item.stableId !== 'string' || item.item?.id === undefined) {
      throw new CorpusValidationError(path, `an item in pack.items is not a well-formed IncludedItem`);
    }
  }
  for (const item of pack.excluded as ExcludedItem[]) {
    if (item.kind !== 'excluded' || item.item?.id === undefined) {
      throw new CorpusValidationError(path, `an item in pack.excluded is not a well-formed ExcludedItem`);
    }
  }
}

/** Reviver that turns every ISO-8601 string under `pack`/`output` timestamp-shaped fields back
 * into a `Date` — the corpus round-trips through JSON, and `EvidenceItem`/`MetricFact` both carry
 * real `Date`s once loaded (matching what `buildEvidencePack` itself produces at runtime). */
const DATE_KEYS = new Set([
  'publishedAt',
  'availableAt',
  'ingestedAt',
  'lastCheckedAt',
]);

function reviveDates(key: string, value: unknown): unknown {
  if (DATE_KEYS.has(key) && typeof value === 'string') return new Date(value);
  return value;
}

async function readJson(path: string): Promise<unknown> {
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw, reviveDates);
}

export async function loadCorpusPack(id: string, root: string = DEFAULT_CORPUS_ROOT): Promise<EvalCorpusPack> {
  const path = join(root, 'packs', `${id}.json`);
  const raw = await readJson(path);
  if (typeof raw !== 'object' || raw === null || !('meta' in raw) || !('pack' in raw)) {
    throw new CorpusValidationError(path, 'expected { meta, pack }');
  }
  const { meta, pack } = raw as { meta: unknown; pack: unknown };
  const parsedMeta = evalCorpusPackMeta.safeParse(meta);
  if (!parsedMeta.success) {
    throw new CorpusValidationError(path, parsedMeta.error.issues.map((i) => i.message).join('; '));
  }
  assertIsEvidencePack(path, pack);
  return { meta: parsedMeta.data, pack };
}

export async function loadCorpus(root: string = DEFAULT_CORPUS_ROOT): Promise<readonly EvalCorpusPack[]> {
  const dir = join(root, 'packs');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const packs = await Promise.all(files.map((f) => loadCorpusPack(f.replace(/\.json$/, ''), root)));
  return packs;
}

export async function loadSeededErrorAnswer(
  id: string,
  root: string = DEFAULT_CORPUS_ROOT,
): Promise<SeededErrorFile> {
  const path = join(root, 'seeded-errors', `${id}.json`);
  const raw = await readJson(path);
  const parsed = seededErrorFile.safeParse(raw);
  if (!parsed.success) {
    throw new CorpusValidationError(path, parsed.error.issues.map((i) => i.message).join('; '));
  }
  return parsed.data;
}

export async function loadSeededErrorCorpus(
  root: string = DEFAULT_CORPUS_ROOT,
): Promise<readonly SeededErrorFile[]> {
  const dir = join(root, 'seeded-errors');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  return Promise.all(files.map((f) => loadSeededErrorAnswer(f.replace(/\.json$/, ''), root)));
}
