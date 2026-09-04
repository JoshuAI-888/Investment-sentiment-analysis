import { NextResponse } from 'next/server';

/** Fixture state until F11 (Wave 3) lands (F01 §4.6). No provider is called. */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  return NextResponse.json({
    state: 'fixture',
    route: `/api/research/${runId}`,
    owner: 'F11 (Wave 3)',
    data: null,
  });
}
