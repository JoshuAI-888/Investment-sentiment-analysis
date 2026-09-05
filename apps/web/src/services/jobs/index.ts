/**
 * F20 §4.2–§4.4 — the scoring queue, its worker, the re-score job and the outage → abstention
 * gate.
 *
 * The service half (`services/scorer/`) is a separate deploy target and is not imported from
 * here; the only thing this directory knows about it is the HTTP contract in
 * `adapters/scorer.ts`.
 */
export * from './ports';
export * from './routing';
export * from './scores';
export * from './scoring-queue';
export * from './scoring-worker';
export * from './scorer-client';
export * from './rescore';
export * from './stance-availability';
export * from './rni-model-runtime';
export * from './rni-model-catalogue';
