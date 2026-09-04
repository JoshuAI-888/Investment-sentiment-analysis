/**
 * The confirmed Substack publication set — F04 §4.3, `DEPLOY.md` MT-15.
 *
 * MT-15 named the population (13 publications, 10 of 11 GICS sectors, owner-confirmed
 * 2026-09-04); this module is the "wiring" `PROGRESS.md` and `docs/progress/collect.md` describe
 * as the remaining engineering task. It loads and validates the committed list so F16a's future
 * dispatcher has something to iterate and F10's disclosure (source spec, the *"curated
 * publication set, selected on the basis recorded in config version {v}"* line) has a basis
 * string to cite.
 *
 * **Not yet a `config_version` row.** `contracts/config.ts`'s `app_setting` table is where this
 * belongs once F15's versioned-config machinery exists and a live `DATABASE_URL` is reachable —
 * the same blocker `repositories/universe-seed.ts` has for the symbol list. Until then this is a
 * committed, disclosed JSON artifact, exactly as `migrations/seed/universe-v1.json` was before
 * `pnpm seed:universe` had a database to run against.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const SEED_FILE = fileURLToPath(
  new URL('../../migrations/seed/substack-publications-v1.json', import.meta.url),
);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date');

/** `<publication>` in `https://<publication>.substack.com/feed` — see `substack.ts`. */
const slug = z.string().regex(/^[a-z0-9-]+$/, 'must be a lowercase substack subdomain slug');

export const substackPublication = z.object({
  slug,
  name: z.string().min(1),
  sector: z.string().min(1),
});
export type SubstackPublication = z.infer<typeof substackPublication>;

export const substackPublicationSeedFile = z.object({
  confirmedAt: isoDate,
  basis: z.string().min(1),
  sectorsRepresented: z.number().int().positive(),
  sectorsTotal: z.number().int().positive(),
  disclosedGaps: z.array(z.object({ sector: z.string().min(1), reason: z.string().min(1) })),
  publications: z.array(substackPublication).min(1),
});
export type SubstackPublicationSeedFile = z.infer<typeof substackPublicationSeedFile>;

export class SubstackPublicationListMissing extends Error {
  constructor(file: string) {
    super(
      `No Substack publication list at ${file}. This is DEPLOY.md MT-15: the basis is decided ` +
        '(D-29, sector coverage) but the confirmed set has not been committed. Wiring an invented ' +
        'list would put an undisclosed selection bias under the Substack axis, which source §6.1 ' +
        'requires disclosed on every aggregate.',
    );
    this.name = 'SubstackPublicationListMissing';
  }
}

/**
 * Loads and validates the committed publication set. Throws `SubstackPublicationListMissing` if
 * the file is absent — mirroring `universe-seed.ts`'s `loadSeedFile`, this refuses to fabricate
 * a list rather than silently returning an empty one.
 */
export async function loadSubstackPublicationSeed(
  file: string = SEED_FILE,
): Promise<SubstackPublicationSeedFile> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new SubstackPublicationListMissing(path.relative(process.cwd(), file));
  }
  return substackPublicationSeedFile.parse(JSON.parse(raw));
}

/** The flat publication list — what a dispatcher iterates over. */
export async function getSubstackPublications(
  file: string = SEED_FILE,
): Promise<SubstackPublication[]> {
  const seed = await loadSubstackPublicationSeed(file);
  return seed.publications;
}

/**
 * F10's disclosure line, filled in from the committed list rather than hand-typed at each call
 * site: *"curated publication set, selected on the basis recorded in config version {v}."* — the
 * `{v}` clause is left for the future `config_version` wiring; today's disclosure names the JSON
 * artifact instead, which is the only version that currently exists.
 */
export async function getSubstackDisclosureBasis(file: string = SEED_FILE): Promise<string> {
  const seed = await loadSubstackPublicationSeed(file);
  return `${seed.basis} Confirmed ${seed.confirmedAt}; ${seed.publications.length} publications across ${seed.sectorsRepresented} of ${seed.sectorsTotal} GICS sectors.`;
}
