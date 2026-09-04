import { NextResponse } from 'next/server';

/** Fixture state until F17 (SURFACE) lands (F01 §4.6). No provider is called. */
export function GET() {
  return NextResponse.json({
    state: 'fixture',
    route: '/api/architecture',
    owner: 'F17 (SURFACE)',
    data: null,
  });
}
