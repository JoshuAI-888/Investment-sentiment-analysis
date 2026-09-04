import { NextResponse } from 'next/server';

/** Fixture state until F05 (SPINE) lands (F01 §4.6). No provider is called. */
export async function GET(_request: Request, { params }: { params: Promise<{ calculationId: string; inputKey: string }> }) {
  const { calculationId, inputKey } = await params;

  return NextResponse.json({
    state: 'fixture',
    route: `/api/calculations/${calculationId}/inputs/${inputKey}/raw`,
    owner: 'F05 (SPINE)',
    data: null,
  });
}
