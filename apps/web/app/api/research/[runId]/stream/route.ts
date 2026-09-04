import { requireUser, UnauthenticatedError, PasswordChangeRequiredError } from '@/services/auth';
import { reloadResearchRun, listRunEventsSince } from '@/services/research/run-service';

/**
 * F11 §4.3 — `GET /api/research/:runId/stream`. Server-Sent Events, polling `research_event` for
 * rows past the last sequence this connection has already sent, until the run reaches a terminal
 * `research_run.status` or the connection closes.
 *
 * **Why polling the database rather than a live in-process stream.** The state machine that
 * produces these events runs inside a *different* function invocation's `after()` callback
 * (`app/api/research/route.ts`) — there is no in-process channel between that invocation and this
 * one to stream over even in principle, on a serverless platform where two requests are not
 * guaranteed to land on the same instance. Polling the row a producer already committed is the
 * only mechanism that works regardless of instance topology, and it is the same mechanism a
 * reload/refresh of `GET /api/research/:runId` already relies on — "the events are the source of
 * truth, not the stream" (F11 §4.1) is what makes this correct rather than a workaround.
 *
 * **Never streams raw model tokens, tool arguments, or a provider payload** (F11 §4.3) —
 * `research_event.payload` is dropped here exactly as it is on the plain GET route; only
 * `eventType`/`label`/`sequence` cross the wire.
 */
export const maxDuration = 30;

const POLL_INTERVAL_MS = 300;
const STREAM_HARD_CAP_MS = 35_000; // F11 §4.2's 30 s run cap, plus headroom for the final event to land.

function sseLine(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof PasswordChangeRequiredError) {
      return new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 });
    }
    throw error;
  }

  const { runId } = await params;
  const initial = await reloadResearchRun(runId);
  if (initial === null) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      let lastSequence = 0;
      // Replay whatever already happened before this connection opened — a client that opens
      // the stream slightly late (or reconnects mid-run) still sees the full history, not just
      // what happens from here forward.
      for (const event of initial.events) {
        controller.enqueue(encoder.encode(sseLine({ sequence: event.sequence, eventType: event.eventType, label: event.label })));
        lastSequence = Math.max(lastSequence, event.sequence);
      }

      let status = initial.run.status;
      const TERMINAL = new Set(['complete', 'degraded', 'verification_failed', 'failed', 'retracted']);

      while (!TERMINAL.has(status) && Date.now() - startedAt < STREAM_HARD_CAP_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        const events = await listRunEventsSince(runId, lastSequence);
        for (const event of events) {
          controller.enqueue(encoder.encode(sseLine({ sequence: event.sequence, eventType: event.eventType, label: event.label })));
          lastSequence = event.sequence;
        }

        const reloaded = await reloadResearchRun(runId);
        if (reloaded !== null) status = reloaded.run.status;
      }

      controller.enqueue(encoder.encode(sseLine({ sequence: lastSequence + 1, eventType: 'stream_end', label: status })));
      controller.close();
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
