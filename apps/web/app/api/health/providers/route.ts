import { NextResponse } from 'next/server';

/** Fixture state until F04 (COLLECT) lands (F01 §4.6). No provider is called. */
export function GET() {
  return NextResponse.json({
    state: 'fixture',
    route: '/api/health/providers',
    owner: 'F04 (COLLECT)',
    data: null,
  });
}
