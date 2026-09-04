/**
 * F21 §3 — `ToolResultEnvelope`. The shape every MCP tool result conforms to.
 *
 * **Not placed in `src/contracts/`.** That directory is SPINE-owned
 * (`docs/CLAUDE.md`, `docs/progress/surface.md`) and this lane may consume it but not add to it
 * — the same precedent `services/ticker/contract.ts` (F09) already set and documents in its own
 * header: "this lane may consume it but not add to it." This module is `services/mcp/`'s
 * equivalent.
 *
 * **Why one shared envelope, not one shape per tool.** F21 §4.1 rule 3: "Every result carries
 * structured `coverage`, `n`, `window`, `limitations[]`, `mustNotClaim[]`." A per-tool ad hoc
 * shape would let one tool's author quietly omit a field the spec requires; a single generic
 * type with every field required (never optional) makes the omission a compile error instead of
 * a code-review miss.
 *
 * **`calculationIds[]` is not named in §4.1 rule 3's list but is added here, deliberately.**
 * DoD item 3 — "every numeric in every result carries a `calculationId` that resolves" — needs a
 * flat, envelope-level list a contract test can iterate and resolve via `open_calculation`
 * without knowing each tool's own `data` shape. Every numeric in `data` traces back to one of
 * these ids; the corpus-leak/contract tests assert that.
 */
import { z } from 'zod';

/** F22's four coverage axes, plus `null` for a tool whose result spans none of them (e.g. `open_calculation`). */
export const mcpCoverageAxis = z.enum(['reddit', 'x', 'substack', 'market']);
export type McpCoverageAxis = z.infer<typeof mcpCoverageAxis>;

/**
 * A compact projection of `contracts/coverage.ts#CoverageWindow` — the floor and gap count a
 * tool result carries inline, not the full gap list (which belongs to `get_coverage` itself,
 * §4.2: "**Called before any historical claim**"). Every axis a result touches gets one of these.
 */
export const mcpCoverageEntry = z.object({
  axis: mcpCoverageAxis,
  /** F22's coverage floor — `null` only when the axis has never recorded a `collector_start` row. */
  startedAt: z.string().nullable(),
  gapCount: z.number().int().nonnegative(),
  /** Verbatim per §4.4/D-16 — every historical view carries its floor as a rendered sentence. */
  disclosure: z.string().min(1),
});
export type McpCoverageEntry = z.infer<typeof mcpCoverageEntry>;

export const mcpWindow = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
  /** Human-readable, e.g. "24 h", "evidence retrieved this render", "since previous observation". */
  label: z.string().min(1),
});
export type McpWindow = z.infer<typeof mcpWindow>;

/**
 * The generic envelope. `data` is `unknown` here — each tool exports its own zod schema for
 * `data` and a contract test composes `mcpToolResultEnvelope.extend({ data: <tool schema> })` to
 * check both at once (mirrors `tickerSnapshotResponse`'s own discriminated-union pattern).
 */
export const mcpToolResultEnvelope = z.object({
  ok: z.literal(true),
  tool: z.string().min(1),
  data: z.unknown(),
  /** Every axis this result's `data` drew on. Empty array only for a tool with no axis-scoped read (`open_calculation`). */
  coverage: z.array(mcpCoverageEntry),
  /** The sample size behind `data`, or `null` when the result is not a sampled aggregate (e.g. `open_calculation`, `get_coverage`). */
  n: z.number().int().nonnegative().nullable(),
  window: mcpWindow.nullable(),
  /** Reproduced from the registry, never paraphrased — F21 §4.1 rule 3. */
  limitations: z.array(z.string().min(1)),
  /** The §6.4 line(s), or (once Tier D4 exists) the promoted disclosure — see `tierD4.ts`. Never empty. */
  mustNotClaim: z.array(z.string().min(1)).min(1),
  /** DoD item 3. Every numeric in `data` resolves through `open_calculation` to one of these. */
  calculationIds: z.array(z.string().min(1)),
});
export type McpToolResultEnvelope = z.infer<typeof mcpToolResultEnvelope>;

export const mcpToolErrorEnvelope = z.object({
  ok: z.literal(false),
  tool: z.string().min(1),
  error: z.object({
    code: z.enum([
      'unauthenticated',
      'not_found',
      'ambiguous',
      'ineligible',
      'invalid_arguments',
      'unresolvable_calculation',
    ]),
    message: z.string().min(1),
  }),
});
export type McpToolErrorEnvelope = z.infer<typeof mcpToolErrorEnvelope>;

export const mcpToolResult = z.discriminatedUnion('ok', [mcpToolResultEnvelope, mcpToolErrorEnvelope]);
export type McpToolResult = z.infer<typeof mcpToolResult>;
