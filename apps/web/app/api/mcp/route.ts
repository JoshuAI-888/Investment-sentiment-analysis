import { NextResponse } from 'next/server';
import { requireUser, UnauthenticatedError, PasswordChangeRequiredError } from '@/services/auth';
import { handleJsonRpc } from '@/services/mcp/server';

/**
 * F21 §2/§6 — the MCP server route. `POST /api/mcp` accepts a JSON-RPC 2.0 request body and
 * returns a JSON-RPC 2.0 response — the Streamable HTTP transport's non-streaming shape (every
 * tool here is a quick, bounded read; nothing needs a long-running SSE stream, so this
 * deliberately does not implement one — a documented scope decision, not an oversight).
 *
 * **Transport choice, and why.** A Next.js route handler is this app's only server-process shape
 * — every other feature (F02's auth, F09's ticker reads, F11's research runs) is a route handler,
 * and `app/api/` already has no MCP route. Building the MCP server as one more route handler
 * under `app/api/mcp/` keeps it in the same deploy target, the same auth pattern, and the same
 * request lifecycle as everything else in this app, rather than standing up a second process
 * this single-Vercel-deployment product has nowhere to run.
 *
 * **Auth (§6 DoD): "Server authentication is required; an unauthenticated caller reaches no
 * priced provider and no LLM."** `requireUser()` is called first, in this handler's own body —
 * the exact F02 §4.4 pattern `app/api/ticker/[symbol]/snapshot/route.ts` already uses, not a
 * second mechanism invented for MCP. Every tool handler below it only reads already-collected,
 * already-computed data (`services/ticker/snapshot.ts`'s own documented "no provider call in the
 * read path") — so gating the whole endpoint on `requireUser()` is deliberately stricter than
 * the DoD's own minimum ("no *priced* provider or LLM"), which is the safer direction to be
 * stricter in.
 */
export async function POST(request: Request) {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof PasswordChangeRequiredError) {
      return NextResponse.json(
        { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Unauthenticated. Sign in required.' } },
        { status: 401 },
      );
    }
    throw error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: request body is not valid JSON.' } },
      { status: 400 },
    );
  }

  const response = await handleJsonRpc(body);
  return NextResponse.json(response);
}
