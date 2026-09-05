/**
 * F11 §4.3 — the streaming event contract.
 *
 * "High-level, user-meaningful events only — never raw model tokens, never tool arguments,
 * never anything that leaks a provider payload." This schema is the enforcement: a
 * `StreamEvent`'s `detail` is a closed, small vocabulary of primitives (counts, a stage name, a
 * display-rounded metric, a claim's public text) — there is no field wide enough to smuggle a
 * prompt or a raw payload through it. `toStreamEvent` is the only function allowed to build one,
 * so "what can appear on the wire" is reviewable in one place.
 */
import { z } from 'zod';
import type { ResearchEvent } from '@/contracts/research';
import type { ResearchStage } from './state-machine';

export const streamEventDetail = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stage'), stage: z.string().min(1) }),
  z.object({ kind: z.literal('evidence_gathered'), retrievedCount: z.number().int().nonnegative(), usedCount: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('metric'), metricId: z.string().min(1), displayValue: z.string(), unit: z.string() }),
  z.object({ kind: z.literal('budget_overrun'), stage: z.string().min(1), budgetMs: z.number().int().positive() }),
  z.object({ kind: z.literal('claim'), section: z.string().min(1), text: z.string().min(1) }),
  z.object({ kind: z.literal('outcome'), status: z.string().min(1), reason: z.string().nullable() }),
]);
export type StreamEventDetail = z.infer<typeof streamEventDetail>;

export const streamEvent = z.object({
  runId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  detail: streamEventDetail,
});
export type StreamEvent = z.infer<typeof streamEvent>;

/** Renders one SSE frame. `id:` lets a reconnecting client resume with `Last-Event-ID`. */
export function toSseFrame(event: StreamEvent): string {
  return `id: ${String(event.sequence)}\ndata: ${JSON.stringify(event)}\n\n`;
}

export type NewStreamEventInput = {
  runId: string;
  sequence: number;
  createdAt: Date;
  detail: StreamEventDetail;
};

export function buildStreamEvent(input: NewStreamEventInput): StreamEvent {
  return streamEvent.parse({
    runId: input.runId,
    sequence: input.sequence,
    createdAt: input.createdAt.toISOString(),
    detail: input.detail,
  });
}

/** For a stage transition specifically — the common case, used by `orchestrator.ts` at every step. */
export function stageEventDetail(stage: ResearchStage): StreamEventDetail {
  return { kind: 'stage', stage };
}

/**
 * Replays a run's persisted `research_event` rows as the public stream shape (`GET
 * /api/research/:runId/stream`'s reload path). Only rows whose `payload` already matches
 * `streamEventDetail` are replayable; a malformed row is dropped rather than thrown on, since a
 * reload must never fail because one historical row cannot be re-rendered.
 */
export function replayStreamEvents(events: readonly ResearchEvent[]): readonly StreamEvent[] {
  return events.flatMap((event) => {
    const detail = streamEventDetail.safeParse(event.payload);
    if (!detail.success) return [];
    return [
      buildStreamEvent({
        runId: event.runId,
        sequence: event.sequence,
        createdAt: event.createdAt,
        detail: detail.data,
      }),
    ];
  });
}
