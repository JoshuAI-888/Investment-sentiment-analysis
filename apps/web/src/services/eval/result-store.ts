/**
 * Eval result storage and run-to-run comparison (F12 §4.5 / DoD: "eval results are stored per
 * run and comparable across runs").
 *
 * **Why a file store and not a database table.** A durable, queryable `eval_run` table is
 * `src/repositories/`'s (SPINE's) territory, and this lane may not add one
 * (`docs/progress/f12-lane.md`). `EvalResultStore` is the seam: `createFileEvalResultStore`
 * satisfies today's DoD item with an append-only JSON-lines file, in the same spirit as
 * `02-ARCHITECTURE-CONTRACTS.md` §5's append-only tables; a real `eval_run` table, once SPINE
 * has one, is a drop-in second implementation of the same port. See the lane report's CONTRACTS
 * field.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import Decimal from 'decimal.js';
import { evalRunRecord, type EvalRunRecord } from './contracts';

export type EvalResultStore = {
  save(record: EvalRunRecord): Promise<void>;
  list(): Promise<EvalRunRecord[]>;
  latest(): Promise<EvalRunRecord | null>;
};

export function createInMemoryEvalResultStore(seed: readonly EvalRunRecord[] = []): EvalResultStore {
  const records: EvalRunRecord[] = [...seed];
  return {
    async save(record) {
      records.push(record);
    },
    async list() {
      return [...records];
    },
    async latest() {
      return records.length === 0 ? null : records[records.length - 1]!;
    },
  };
}

export function createFileEvalResultStore(filePath: string): EvalResultStore {
  const list = async (): Promise<EvalRunRecord[]> => {
    if (!existsSync(filePath)) return [];
    const lines = readFileSync(filePath, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0);
    return lines.map((line) => evalRunRecord.parse(JSON.parse(line)));
  };

  return {
    async save(record) {
      const validated = evalRunRecord.parse(record);
      const dir = dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(filePath, `${JSON.stringify(validated)}\n`, 'utf8');
    },
    list,
    async latest() {
      const all = await list();
      return all.length === 0 ? null : all[all.length - 1]!;
    },
  };
}

export type RunComparison = {
  previousRunId: string;
  currentRunId: string;
  /** Decimal strings, signed — `gate.ts`'s `perAxisMean`/`overallMean` are decimal strings too. */
  overallMeanDelta: string;
  perAxisDelta: { c1: string; c2: string; c3: string; c4: string };
  modelRouteChanged: boolean;
  verifierCatchRateChanged: boolean;
  /** §4.5: "an unexplained score movement between runs is investigated, not accepted." */
  unexplainedMovement: boolean;
};

/**
 * A movement is "explained" only by a recorded model-route change (§4.5: "a model-route change
 * re-runs the whole corpus and records the delta"). The 0.01 tolerance is deliberately tight:
 * temperature 0 against a byte-identical, frozen corpus should reproduce near-exactly, so any
 * larger drift with no route change is exactly the "investigated, not accepted" case.
 */
const UNEXPLAINED_MOVEMENT_TOLERANCE = '0.01';

/** `current - previous`, in `decimal.js` — `gate.ts`'s means are decimal strings end to end, never JS numbers. */
function delta(current: string, previous: string): Decimal {
  return new Decimal(current).minus(previous);
}

export function compareRuns(previous: EvalRunRecord, current: EvalRunRecord): RunComparison {
  const c1Delta = delta(current.tierC.perAxisMean.c1, previous.tierC.perAxisMean.c1);
  const c2Delta = delta(current.tierC.perAxisMean.c2, previous.tierC.perAxisMean.c2);
  const c3Delta = delta(current.tierC.perAxisMean.c3, previous.tierC.perAxisMean.c3);
  const c4Delta = delta(current.tierC.perAxisMean.c4, previous.tierC.perAxisMean.c4);
  const overallMeanDelta = delta(current.tierC.overallMean, previous.tierC.overallMean);

  const modelRouteChanged =
    previous.modelRoute.judgeModelId !== current.modelRoute.judgeModelId ||
    previous.modelRoute.judgeModelVersion !== current.modelRoute.judgeModelVersion;

  const verifierCatchRateChanged = previous.verifier?.catchRate !== current.verifier?.catchRate;

  const unexplainedMovement =
    !modelRouteChanged && overallMeanDelta.abs().greaterThan(UNEXPLAINED_MOVEMENT_TOLERANCE);

  return {
    previousRunId: previous.runId,
    currentRunId: current.runId,
    overallMeanDelta: overallMeanDelta.toFixed(4),
    perAxisDelta: { c1: c1Delta.toFixed(4), c2: c2Delta.toFixed(4), c3: c3Delta.toFixed(4), c4: c4Delta.toFixed(4) },
    modelRouteChanged,
    verifierCatchRateChanged,
    unexplainedMovement,
  };
}
