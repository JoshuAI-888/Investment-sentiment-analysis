import { NextResponse } from 'next/server';

/** Fixture state until F16a (COLLECT) lands (F01 §4.6). No provider is called. */
export function POST() {
  return NextResponse.json({
    state: 'fixture',
    route: '/api/cron/dispatch',
    owner: 'F16a (COLLECT)',
    data: null,
  });
}
