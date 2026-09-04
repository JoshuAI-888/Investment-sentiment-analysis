/**
 * The dependency direction from `docs/02-ARCHITECTURE-CONTRACTS.md` §3, as data.
 *
 *   contracts (zod)  ←  everything
 *   repositories     ←  services
 *   adapters         ←  services
 *   analytics        ←  services            (analytics depends only on contracts)
 *   services         ←  route handlers, server actions, server components
 *   ui components    ←  pages
 *
 * "A dependency that points the other way is a review failure." This file is what makes it a
 * build failure instead, which is the only version of the rule that survives a deadline.
 */

export const LAYERS = [
  'contracts',
  'repositories',
  'adapters',
  'analytics',
  'calc',
  'services',
  'agent',
  'ui',
  'app',
] as const;

export type Layer = (typeof LAYERS)[number];

/** What each layer is allowed to import. Absent from the set means the edge is illegal. */
export const ALLOWED_IMPORTS: Readonly<Record<Layer, readonly Layer[]>> = {
  // Contracts are the shared vocabulary. They depend on nothing, which is what lets
  // everything else depend on them without a cycle.
  contracts: [],

  // Persistence and I/O speak in contracts and are orchestrated by services. Neither may
  // reach back up, and neither may reach across to the other.
  repositories: ['contracts'],
  adapters: ['contracts'],

  // Analytics depends only on contracts — the parenthesised clause in §3, and the reason
  // `no-llm-in-analytics` and `no-float-in-analytics` have anything to bite on.
  analytics: ['contracts'],
  calc: ['contracts'],

  // The agent layer is model access. Services orchestrate it; it does not orchestrate them.
  agent: ['contracts'],

  // Services are the composition root for everything below them.
  services: ['contracts', 'repositories', 'adapters', 'analytics', 'calc', 'agent'],

  // UI components are rendered by pages and receive their data as props. A component that
  // reaches a repository is a component that cannot be tested or reused.
  ui: ['contracts'],

  // Route handlers, server actions and server components: the top of the graph.
  app: ['contracts', 'services', 'ui', 'calc', 'analytics'],
} as const;

const LAYER_SET = new Set<string>(LAYERS);

function isLayer(value: string): value is Layer {
  return LAYER_SET.has(value);
}

/**
 * Which layer a file belongs to, from its path. Returns `undefined` for anything outside the
 * layered tree (config, scripts, tests, lint rules) — those are not governed by §3.
 */
export function layerOfFile(filename: string): Layer | undefined {
  const normalised = filename.replaceAll('\\', '/');

  const inTests = /(^|\/)tests\//.test(normalised);
  if (inTests) return undefined;

  const srcMatch = /(^|\/)src\/([^/]+)\//.exec(normalised);
  if (srcMatch) {
    const segment = srcMatch[2];
    if (segment !== undefined && isLayer(segment)) return segment;
    return undefined;
  }

  // `app/` is the Next.js App Router tree: pages, layouts, route handlers, server actions.
  if (/(^|\/)app\//.test(normalised)) return 'app';

  return undefined;
}

/**
 * Which layer an import specifier points at, from the importing file's own layer.
 * Returns `undefined` for a package import or anything outside the layered tree.
 */
export function layerOfImport(specifier: string, fromLayer: Layer | undefined): Layer | undefined {
  const aliasMatch = /^@\/([^/]+)/.exec(specifier);
  if (aliasMatch) {
    const segment = aliasMatch[1];
    if (segment !== undefined && isLayer(segment)) return segment;
    return undefined;
  }

  if (!specifier.startsWith('.')) return undefined;

  // A relative import that names a layer directory: `../repositories/x`, `./adapters/y`.
  const relativeMatch = /(?:^|\/)(contracts|repositories|adapters|analytics|calc|services|agent|ui)\//.exec(
    specifier,
  );
  if (relativeMatch) {
    const segment = relativeMatch[1];
    if (segment !== undefined && isLayer(segment)) return segment;
  }

  // A relative import with no layer segment stays inside the importing file's own layer,
  // which is always legal.
  return fromLayer;
}
