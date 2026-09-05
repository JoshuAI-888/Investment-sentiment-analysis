/**
 * The pure half of `check:live-readiness` — see `../check-live-readiness.ts` for what the check
 * is for and why it exists at all.
 *
 * Nothing here re-implements F01 §4.2's required-key list. `parseEnv` is the real schema, and a
 * second copy of the list living in a check script would drift from it and then lie in the
 * direction that matters: reporting ready when it is not.
 */
import { parseEnv } from '../../src/env';

export type ReadinessReport =
  | { readonly ok: true }
  | { readonly ok: false; readonly missingKeys: readonly string[] };

/**
 * A deliberately small `.env` reader: `KEY=value`, `export KEY=value`, `#` comments, and
 * surrounding single or double quotes stripped. Not a dotenv implementation — it reads what
 * `vercel env pull` writes, and anything more elaborate is a parser to keep in step with a
 * format this script does not own.
 *
 * A `=` inside a value is preserved (connection strings and tokens routinely carry one); only
 * the first `=` separates key from value.
 */
export function parseDotenv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice('export '.length) : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * `PROVIDER_MODE` is forced to `live` regardless of what the source says. The question is always
 * "would this boot in live mode" — honouring a fixture-mode file's own setting would make it
 * pass trivially and answer a question nobody asked.
 */
export function checkLiveReadiness(source: Record<string, string | undefined>): ReadinessReport {
  const result = parseEnv({ ...source, PROVIDER_MODE: 'live' });
  if (result.ok) return { ok: true };
  const keys = result.error.issues.map((issue) => issue.path.join('.') || '(root)');
  return { ok: false, missingKeys: [...new Set(keys)].sort() };
}
