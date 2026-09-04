/**
 * Everything the research orchestrator needs from the outside world, as interfaces rather than
 * modules it imports — the same discipline `adapters/ports.ts` uses for the provider wrapper
 * (`02-ARCHITECTURE-CONTRACTS.md` §3: `services` may import `repositories`, `adapters`,
 * `analytics`, `calc`; nothing here reaches across a layer it should not).
 *
 * **Why ports instead of the real repository / F10 service.** Three things this lane does not
 * own do not exist yet as importable code:
 *
 * 1. `src/repositories/research.ts` — no repository module writes `research_run`,
 *    `research_event` or `claim_ledger` rows. `src/repositories/` is SPINE-owned; this lane
 *    reports the gap (see the build report's `CONTRACTS` section) rather than writing it.
 * 2. F10's evidence-gathering service (`src/services/evidence/`) is being built in parallel, in
 *    a worktree this lane cannot see. Importing it would make this build's outcome depend on
 *    another lane's in-flight, uncommitted state — precisely what the contract freeze (D-42)
 *    exists to avoid.
 * 3. A "list this security's latest deterministic metrics" query does not exist in
 *    `src/repositories/calculations.ts` either (only `findCalculationSnapshot` by id and
 *    `insert*` are exported) — another SPINE gap, reported the same way.
 *
 * `ResearchRepositoryPort`, `EvidenceGatheringPort` and `MetricsLookupPort` are the seams this
 * file draws around all three gaps. `testing.ts` provides in-memory implementations for every
 * test in this lane; `repository-memory.ts` provides the same implementation wired into the
 * (fixture-only, clearly labelled) API routes until the real ones land.
 */
import type { ClaimLedgerEntry, ResearchEvent, ResearchRun, researchRunStatus } from '@/contracts/research';
import type { EvidencePack } from '@/contracts/evidence-pack';
import type { z } from 'zod';

/** `contracts/research.ts` exports the schema (`researchRunStatus`) but not its inferred type. */
export type ResearchRunStatus = z.infer<typeof researchRunStatus>;

// ── Clock (reused from the adapters layer; services may import adapters) ─────────────────────
export type { Clock } from '@/adapters/ports';

// ── The research repository (research_run / research_event / claim_ledger) ───────────────────

export type NewResearchRun = {
  id: string;
  userId: string;
  securityId: string | null;
  question: string;
  status: ResearchRunStatus;
  coverageStatus: string;
  inputCutoff: Date;
  startedAt: Date;
  promptVersion: string;
  modelRoute: unknown;
  toolManifest: unknown;
};

export type ResearchRunUpdate = {
  status: ResearchRunStatus;
  completedAt: Date | null;
  costUsd: string;
  result: unknown;
  error: unknown;
};

export type NewResearchEvent = {
  runId: string;
  sequence: number;
  eventType: string;
  label: string;
  payload: unknown;
  createdAt: Date;
};

export type NewClaimLedgerEntry = Omit<ClaimLedgerEntry, 'id'> & { id?: string };

export type RetractionInput = {
  runId: string;
  reason: string;
  actor: string;
  at: Date;
};

export interface ResearchRepositoryPort {
  createRun(input: NewResearchRun): Promise<ResearchRun>;
  /** Append-only (§5): never updates an existing `research_event` row. */
  appendEvent(input: NewResearchEvent): Promise<ResearchEvent>;
  listEvents(runId: string): Promise<readonly ResearchEvent[]>;
  getRun(runId: string): Promise<ResearchRun | null>;
  updateRun(runId: string, update: ResearchRunUpdate): Promise<ResearchRun>;
  /** Append-only (§5): the claim ledger has no update path — a retraction adds a new fact, never edits one. */
  insertClaims(entries: readonly NewClaimLedgerEntry[]): Promise<readonly ClaimLedgerEntry[]>;
  listClaims(runId: string): Promise<readonly ClaimLedgerEntry[]>;
  /** F-20 / R-18. Refuses (throws `RetractionError`) unless the run is `complete` or `degraded`. */
  retractRun(input: RetractionInput): Promise<ResearchRun>;
}

export class RetractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetractionError';
  }
}

// ── Evidence gathering (F10's service, consumed only through the frozen contract) ────────────

export type EvidenceQuery = {
  securityId: string;
  question: string;
  window: { from: Date; to: Date };
};

/**
 * The deadline is passed **in**, not enforced by the caller racing a promise — the fan-out and
 * classification stages both live inside F10's service (`02-ARCHITECTURE-CONTRACTS.md` §4.2:
 * "proceed with what returned; record the gap" / "proceed with classified subset"), and only
 * the side doing the actual parallel fetch can return a genuine partial result. F11 can only
 * ever fully await or fully abandon an opaque promise; asking the far side to honour a budget
 * and report whether it did is the only way "record the gap" is meaningful rather than fiction.
 */
export type EvidenceGatheringBudgets = { fanOutMs: number; classificationMs: number };

export type EvidenceGatheringResult = {
  pack: EvidencePack;
  fanOutMs: number;
  fanOutTimedOut: boolean;
  classificationMs: number;
  classificationTimedOut: boolean;
  /** F10 §4.2's "classified subset" count — may be less than `pack.items.length` on overrun. */
  classifiedCount: number;
};

export interface EvidenceGatheringPort {
  gather(query: EvidenceQuery, budgets: EvidenceGatheringBudgets): Promise<EvidenceGatheringResult>;
}

// ── Deterministic metrics (F06 methods, read through a lookup this lane does not own) ────────

export type MetricRef = {
  metricId: string;
  /** The registered method's own `methodId`, for the claim ledger's `metricIds` and the Inspector link. */
  methodId: string;
  /** Display-rounded, exactly as a reader would see it — this is what check 1 string-matches against. */
  displayValue: string;
  unit: string;
  observedAt: Date;
};

export interface MetricsLookupPort {
  forSecurity(securityId: string, asOf: Date): Promise<readonly MetricRef[]>;
}

// ── ModelClient (`02-ARCHITECTURE-CONTRACTS.md` §4.6) ────────────────────────────────────────

export type ClassifyInput = { text: string; context: Readonly<Record<string, unknown>> };
export type SynthInput = { prompt: string; context: Readonly<Record<string, unknown>> };
export type VerifyInput = { prompt: string; context: Readonly<Record<string, unknown>> };

/**
 * Not redefined from a `src/contracts/` file because none exists yet — §4.6 describes the
 * shape but no lane has shipped it as code (see this module's docstring, gap 2's sibling: a
 * fourth gap, smaller, reported alongside the others). Defined once, here, so F10/F12 have a
 * concrete shape to converge on rather than a paragraph of prose.
 */
export interface ModelClient {
  classify<T>(task: 'stance', input: ClassifyInput, schema: z.ZodType<T>): Promise<T>;
  synthesize<T>(task: 'synthesis' | 'followup', input: SynthInput, schema: z.ZodType<T>): Promise<T>;
  verify<T>(task: 'verify', input: VerifyInput, schema: z.ZodType<T>): Promise<T>;
}

// ── Budget (D-20's global ceiling; reused from `services/dashboard/budget.ts`) ────────────────

export type BudgetCheck = (now: Date) => Promise<
  | { allowed: true; spentUsd: string; ceilingUsd: string }
  | { allowed: false; spentUsd: string; ceilingUsd: string; message: string }
>;
