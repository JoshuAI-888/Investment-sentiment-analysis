/** F15 — shared response mapping for every admin mutation route. One shape, one place. */
import { NextResponse } from 'next/server';
import type { MutationOutcome } from './mutation';

export function mutationResponse(outcome: MutationOutcome): NextResponse {
  if (outcome.ok) {
    return NextResponse.json({
      status: 'ok',
      objectId: outcome.objectId,
      rollbackTarget: outcome.rollbackTarget,
      impactPreview: outcome.impactPreview,
      auditEventId: outcome.auditEventId,
    });
  }
  if (outcome.kind === 'validation') {
    return NextResponse.json({ status: 'invalid', issues: outcome.issues }, { status: 400 });
  }
  return NextResponse.json(
    { status: 'conflict', objectId: outcome.objectId, diff: outcome.diff, message: outcome.message },
    { status: 409 },
  );
}
