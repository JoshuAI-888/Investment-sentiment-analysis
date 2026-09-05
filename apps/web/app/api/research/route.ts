import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PasswordChangeRequiredError, requireUser, UnauthenticatedError } from '@/services/auth';
import { createResearchDeps, resolveSecuritySymbol } from '@/services/research/composition';
import { runResearch } from '@/services/research/orchestrator';
import { buildStreamEvent, streamEventDetail, toSseFrame } from '@/services/research/stream-events';

/**
 * F11 §4.3 — streams the run in real time within one request/response cycle. There is no
 * background job queue yet (F16a is Wave 4+), so this is the only way "first progress event
 * < 1 s" and "deterministic metrics stream first" are observable from outside the process at
 * all — `orchestrator.ts`'s `onEvent` hook fires synchronously right after each event is
 * durably appended, and this handler forwards it as one SSE frame per call.
 *
 * A budget refusal (F11 §6 DoD: "Every run is budget-checked before its first priced call")
 * never creates a `research_run` row — `runResearch` returns `{outcome:'refused', ...}` before
 * anything is persisted, and this handler reports it as a single frame naming why, then closes.
 */
const requestBody = z.object({
  securityId: z.string().uuid(),
  question: z.string().min(1).max(2000),
  subjectSymbols: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  let session;
  try {
    session = await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof PasswordChangeRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    throw error;
  }

  const parsed = requestBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', issues: parsed.error.issues }, { status: 400 });
  }

  const securitySymbol = await resolveSecuritySymbol(parsed.data.securityId);
  if (securitySymbol === null) {
    return NextResponse.json({ error: 'security_not_found' }, { status: 404 });
  }

  const encoder = new TextEncoder();
  // Minted here, not inside `runResearch` — the model client's cost-recording hook
  // (`composition.ts`) needs the run id at construction time, before the run row that id
  // belongs to has even been created.
  const runId = crypto.randomUUID();
  const deps = createResearchDeps({ runId, userId: session.userId });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      deps.onEvent = (event) => {
        const detail = streamEventDetail.safeParse(event.payload);
        if (!detail.success) return; // never surfaces a malformed internal event to the wire
        const frame = buildStreamEvent({
          runId: event.runId,
          sequence: event.sequence,
          createdAt: event.createdAt,
          detail: detail.data,
        });
        controller.enqueue(encoder.encode(toSseFrame(frame)));
      };

      try {
        const outcome = await runResearch(
          {
            runId,
            userId: session.userId,
            securityId: parsed.data.securityId,
            securitySymbol,
            question: parsed.data.question,
            ...(parsed.data.subjectSymbols === undefined ? {} : { subjectSymbols: parsed.data.subjectSymbols }),
          },
          deps,
        );

        if (outcome.outcome === 'refused') {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ kind: 'refused', reason: outcome.reason, message: outcome.message })}\n\n`),
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
