import { NextResponse } from 'next/server';
import { env } from '@/env';
import { verifyQStashRequest } from '@/services/jobs/qstash';
import { runDispatchTick } from '@/services/jobs/dispatch';

/**
 * `POST /api/cron/dispatch` — F16 §4.1. QStash's five-minute schedule (`docs/DEPLOY.md` MT-04)
 * calls this route; nothing else may. Replaces F01 §4.6's fixture placeholder now that F16a's
 * dispatch core exists.
 *
 * **Order is the whole point of step 1 (§6's first DoD item).** The signature is read and
 * verified from the raw request — `await request.text()`, never `request.json()`, since the JWS
 * is computed over the exact raw body and re-serializing through `JSON.parse`/`JSON.stringify`
 * would not reproduce it byte-for-byte — and nothing else in this handler runs until that
 * verification resolves `ok: true`. `runDispatchTick` (the only call in this file that touches
 * Redis or Postgres) is imported and invoked, but never reached, on the rejection path — proven
 * by `tests/contract/qstash-signature.test.ts`, which spies on `runDispatchTick` itself and
 * asserts it was never called for an unsigned or badly-signed request.
 *
 * **`not_configured` renders F01's original fixture shape; every other rejection renders a real
 * 401.** Mirrors `InspectorPage`'s own `data-state="fixture"` vs `data-state="error"` split
 * (`tests/e2e/routes.spec.ts`'s own comment: "no database configured ... F01's route gate
 * exercises this route with no database" vs "a real fault against a real, configured database").
 * `docs/DEPLOY.md` MT-04 has not run in a fixture-mode deployment or in CI's e2e gate, so
 * `QSTASH_CURRENT_SIGNING_KEY` is genuinely unset there — the same "nothing configured at all"
 * state that shape already exists for, not a new carve-out invented for this route. A deployment
 * that *has* set real (or test-provided) signing keys and still fails verification gets the real
 * `401`, never the fixture shape — that failure is a genuine one, not an unconfigured system.
 */
export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get('upstash-signature');

  const verification = await verifyQStashRequest(
    { signature, body, url: request.url },
    { currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY, nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY },
  );

  if (!verification.ok) {
    if (verification.code === 'not_configured') {
      return NextResponse.json({
        state: 'fixture',
        route: '/api/cron/dispatch',
        owner: 'F16a (COLLECT)',
        data: null,
      });
    }
    return NextResponse.json({ error: 'unauthorized', reason: verification.reason }, { status: 401 });
  }

  const result = await runDispatchTick();
  return NextResponse.json(result, { status: result.ran ? 200 : 202 });
}
