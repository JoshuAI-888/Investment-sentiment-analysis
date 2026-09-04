import { NextResponse } from 'next/server';

/** Fixture state until F11 (Wave 3) lands (F01 §4.6). No provider is called. */
export function POST() {
  return NextResponse.json({
    state: 'fixture',
    route: '/api/research',
    owner: 'F11 (Wave 3)',
    data: null,
  });
}
