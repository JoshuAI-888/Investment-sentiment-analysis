/**
 * In-memory fakes for every port `orchestrator.ts` depends on — the same convention
 * `services/attention/testing.ts` and `services/dashboard/testing.ts` already use for this
 * codebase's other orchestration-heavy services. No network, no database, no timers except the
 * ones an injected `Clock` drives.
 *
 * `createInMemoryResearchRepository` is also what `app/api/research/**` is wired to today
 * (`repository-memory.ts`), clearly labelled there as a stand-in for the real
 * `src/repositories/research.ts` this lane does not own and cannot write (see `ports.ts`'s
 * docstring, and the build report's `CONTRACTS` section).
 */
import type { ClaimLedgerEntry, ResearchEvent, ResearchRun } from '@/contracts/research';
import { researchRun } from '@/contracts/research';
import type {
  AuditEntry,
  AuditPort,
  EvidenceGatheringBudgets,
  EvidenceGatheringPort,
  EvidenceGatheringResult,
  EvidenceQuery,
  MetricRef,
  MetricsLookupPort,
  NewClaimLedgerEntry,
  NewResearchEvent,
  NewResearchRun,
  ResearchRepositoryPort,
  ResearchRunUpdate,
  RetractionInput,
} from './ports';
import { RetractionError } from './ports';
import { RETRACTABLE_STATUSES } from './state-machine';

/** Records every entry in order — tests assert on it directly rather than trusting a side effect happened. */
export function createInMemoryAuditLog(): AuditPort & { readonly entries: readonly AuditEntry[] } {
  const entries: AuditEntry[] = [];
  return {
    entries,
    record(entry: AuditEntry): Promise<void> {
      entries.push(entry);
      return Promise.resolve();
    },
  };
}

export function createInMemoryResearchRepository(): ResearchRepositoryPort {
  const runs = new Map<string, ResearchRun>();
  const events = new Map<string, ResearchEvent[]>();
  const claims = new Map<string, ClaimLedgerEntry[]>();
  let claimSeq = 0;

  return {
    createRun(input: NewResearchRun): Promise<ResearchRun> {
      const run = researchRun.parse({
        id: input.id,
        userId: input.userId,
        securityId: input.securityId,
        question: input.question,
        status: input.status,
        coverageStatus: input.coverageStatus,
        inputCutoff: input.inputCutoff,
        startedAt: input.startedAt,
        completedAt: null,
        promptVersion: input.promptVersion,
        modelRoute: input.modelRoute,
        toolManifest: input.toolManifest,
        costUsd: '0',
        result: null,
        error: null,
        retractedReason: null,
        retractedBy: null,
        retractedAt: null,
      });
      runs.set(run.id, run);
      events.set(run.id, []);
      claims.set(run.id, []);
      return Promise.resolve(run);
    },

    appendEvent(input: NewResearchEvent): Promise<ResearchEvent> {
      const event: ResearchEvent = {
        runId: input.runId,
        sequence: input.sequence,
        eventType: input.eventType,
        label: input.label,
        payload: input.payload,
        createdAt: input.createdAt,
      };
      const existing = events.get(input.runId) ?? [];
      existing.push(event);
      events.set(input.runId, existing);
      return Promise.resolve(event);
    },

    listEvents(runId: string): Promise<readonly ResearchEvent[]> {
      return Promise.resolve([...(events.get(runId) ?? [])]);
    },

    getRun(runId: string): Promise<ResearchRun | null> {
      return Promise.resolve(runs.get(runId) ?? null);
    },

    updateRun(runId: string, update: ResearchRunUpdate): Promise<ResearchRun> {
      const existing = runs.get(runId);
      if (existing === undefined) {
        throw new Error(`research_run ${runId} does not exist`);
      }
      const updated: ResearchRun = {
        ...existing,
        status: update.status,
        completedAt: update.completedAt,
        costUsd: update.costUsd,
        result: update.result,
        error: update.error,
      };
      runs.set(runId, updated);
      return Promise.resolve(updated);
    },

    insertClaims(entries: readonly NewClaimLedgerEntry[]): Promise<readonly ClaimLedgerEntry[]> {
      const inserted: ClaimLedgerEntry[] = entries.map((entry) => {
        claimSeq += 1;
        return { ...entry, id: entry.id ?? `00000000-0000-0000-0000-${String(claimSeq).padStart(12, '0')}` };
      });
      for (const entry of inserted) {
        const existing = claims.get(entry.runId) ?? [];
        existing.push(entry);
        claims.set(entry.runId, existing);
      }
      return Promise.resolve(inserted);
    },

    listClaims(runId: string): Promise<readonly ClaimLedgerEntry[]> {
      return Promise.resolve([...(claims.get(runId) ?? [])]);
    },

    retractRun(input: RetractionInput): Promise<ResearchRun> {
      const existing = runs.get(input.runId);
      if (existing === undefined) {
        throw new RetractionError(`research_run ${input.runId} does not exist`);
      }
      if (!RETRACTABLE_STATUSES.has(existing.status)) {
        throw new RetractionError(`research_run ${input.runId} is "${existing.status}", not retractable`);
      }
      if (existing.status !== input.expectedStatus) {
        throw new RetractionError(
          `research_run ${input.runId} is now "${existing.status}", not the "${input.expectedStatus}" this request expected (optimistic-concurrency check)`,
        );
      }
      const updated: ResearchRun = {
        ...existing,
        status: 'retracted',
        retractedReason: input.reason,
        retractedBy: input.actor,
        retractedAt: input.at,
      };
      runs.set(input.runId, updated);
      return Promise.resolve(updated);
    },
  };
}

/** A pre-built `EvidencePack`, handed back verbatim — the shape most orchestrator tests want. */
export function createFixtureEvidencePort(
  build: (query: EvidenceQuery) => Omit<EvidenceGatheringResult, 'fanOutMs' | 'classificationMs'> & Partial<Pick<EvidenceGatheringResult, 'fanOutMs' | 'classificationMs'>>,
): EvidenceGatheringPort {
  return {
    gather(query: EvidenceQuery, _budgets: EvidenceGatheringBudgets): Promise<EvidenceGatheringResult> {
      const built = build(query);
      return Promise.resolve({
        fanOutMs: built.fanOutMs ?? 0,
        classificationMs: built.classificationMs ?? 0,
        ...built,
      });
    },
  };
}

/**
 * A port whose promise never settles — the deterministic way to exercise a `withDeadline`
 * timeout branch (`orchestrator.test.ts`'s deterministic-analysis-overrun case, and
 * `latency-budget.test.ts`). No artificial delay is needed: `Promise.race` can only ever settle
 * via the timeout side against a promise that genuinely never resolves, so there is no ordering
 * ambiguity to get right between two competing fake timers.
 */
export function createHangingEvidencePort(): EvidenceGatheringPort {
  return {
    gather(): Promise<EvidenceGatheringResult> {
      return new Promise(() => {
        // Never settles — see the function doc.
      });
    },
  };
}

export function createFixtureMetricsPort(metrics: readonly MetricRef[]): MetricsLookupPort {
  return {
    forSecurity(): Promise<readonly MetricRef[]> {
      return Promise.resolve(metrics);
    },
  };
}

/** See `createHangingEvidencePort` — the same never-settles shape for the metrics port. */
export function createHangingMetricsPort(): MetricsLookupPort {
  return {
    forSecurity(): Promise<readonly MetricRef[]> {
      return new Promise(() => {
        // Never settles — see `createHangingEvidencePort`'s doc.
      });
    },
  };
}

/** A deterministic, non-real-time clock — `now()` advances only when the caller tells it to. */
export function createFakeClock(startAt: Date): { now(): Date; sleep(ms: number): Promise<void>; advance(ms: number): void } {
  let current = startAt.getTime();
  return {
    now: () => new Date(current),
    sleep: (ms: number) =>
      new Promise((resolve) => {
        current += ms;
        // Yields to the microtask queue so a real-time race (`Promise.race` in `withDeadline`)
        // still resolves the "work" side first when it settles synchronously/immediately —
        // matching how `latency-budget.test.ts` distinguishes "finishes before the deadline"
        // from "times out" without any real elapsed wall-clock time.
        setTimeout(resolve, 0);
      }),
    advance: (ms: number) => {
      current += ms;
    },
  };
}
