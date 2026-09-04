import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RegisteredMethod, RenderedMetric } from './calc-coverage';

export const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Every file under `dir` matching one of `extensions`. Missing directory ⇒ no files. */
export async function walk(dir: string, extensions: readonly string[]): Promise<string[]> {
  if (!(await exists(dir))) return [];

  const found: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walk(full, extensions)));
      continue;
    }
    if (extensions.some((ext) => entry.name.endsWith(ext))) found.push(full);
  }

  return found;
}

export async function readFiles(
  paths: readonly string[],
): Promise<{ path: string; content: string }[]> {
  return Promise.all(
    paths.map(async (target) => ({
      path: path.relative(WEB_ROOT, target),
      content: await readFile(target, 'utf8'),
    })),
  );
}

type RegistryModule = { readonly methods?: readonly RegisteredMethod[] };
type ManifestModule = { readonly metrics?: readonly RenderedMetric[] };

/**
 * F05 owns the method registry and the surface features own the rendered-metric manifest.
 * Neither exists yet, so both load as empty and the check passes — which is exactly the
 * stub F01 §4.4 asks for. The moment F05 adds `src/analytics/registry.ts`, this check
 * starts biting with no further wiring.
 */
export async function loadRegistry(): Promise<readonly RegisteredMethod[]> {
  const target = path.join(WEB_ROOT, 'src/analytics/registry.ts');
  if (!(await exists(target))) return [];
  const module: RegistryModule = await import(target);
  return module.methods ?? [];
}

export async function loadMetricManifest(): Promise<readonly RenderedMetric[]> {
  const target = path.join(WEB_ROOT, 'src/ui/metric-manifest.ts');
  if (!(await exists(target))) return [];
  const module: ManifestModule = await import(target);
  return module.metrics ?? [];
}
