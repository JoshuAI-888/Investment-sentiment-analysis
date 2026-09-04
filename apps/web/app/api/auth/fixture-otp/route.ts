import { NextResponse } from 'next/server';
import { env } from '@/env';
import { readFixtureOtp } from '@/services/auth';

/**
 * **Test-only. 404s in every mode except `fixture`.** F02's non-negotiable is that an OTP
 * "appear[s] in no log, error, or response" — that is a `live`-mode invariant, and this route
 * is how a `fixture`-mode e2e test learns the code it would otherwise have no mailbox to read
 * (`src/services/auth/fixture-otp-store.ts`). `env.PROVIDER_MODE` is validated at process start
 * (`env.ts`) and a real deployment always runs `live`, so there is no environment variable that
 * makes this route live in production.
 */
export function GET(request: Request) {
  if (env.PROVIDER_MODE !== 'fixture') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const email = new URL(request.url).searchParams.get('email');
  if (email === null) {
    return NextResponse.json({ error: 'missing_email' }, { status: 400 });
  }

  const otp = readFixtureOtp(email);
  return NextResponse.json({ otp });
}
