import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Omitted rather than set to undefined: `exactOptionalPropertyTypes` treats an explicit
  // undefined as a value, and Playwright's own default is what we want off CI.
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // An externally-supplied base URL means the app is already running; starting a second one
  // would bind a port that is already taken. `exactOptionalPropertyTypes` forbids writing
  // `webServer: undefined`, so the key is omitted rather than set to undefined.
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        // Truncates `attention_snapshot` once before this run starts — see the file's own doc
        // (lane-review round 3 finding 2) for why `attention.spec.ts`'s cold-start ("nothing has
        // ever been collected") test needs this to be genuinely true rather than accidentally
        // true. Guarded the same way `webServer` below is: an externally-supplied base URL means
        // some other environment owns this database, and this run should not truncate it.
        globalSetup: './tests/e2e/global-setup.ts',
        webServer: {
          // F01 DoD: the gate runs with PROVIDER_MODE=fixture and no provider keys present.
          // `ADMIN_EMAIL_ALLOWLIST` names exactly one fixed address so `auth.spec.ts` can prove
          // a real admin session reaches admin content (lane-review: nothing previously did) —
          // every other e2e test uses a random or `Date.now()`-suffixed address, so this fixed
          // one is never accidentally matched by a "non-admin" test.
          //
          // `BETTER_AUTH_URL: baseURL` matters as of the email+password flow: Better Auth builds
          // absolute verification/reset-password links from this value
          // (`src/services/auth/instance.ts`'s `baseURL`), and a session cookie is host-scoped —
          // set on whatever host a link's origin names, not the path alone. Left unset, `env.ts`
          // falls back to `APP_BASE_URL`'s default (`http://localhost:3000`), a *different* host
          // from Playwright's own `127.0.0.1` `baseURL` above even on the identical port, so a
          // cookie set by `page.goto()`-ing a mailed link would silently not apply to any
          // relative-path navigation this suite makes afterwards. The old OTP flow never hit
          // this: nothing in it ever built an absolute, `baseURL`-derived URL a browser had to
          // navigate to.
          command: `pnpm exec next start --port ${PORT}`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: { PROVIDER_MODE: 'fixture', ADMIN_EMAIL_ALLOWLIST: 'e2e-admin@example.com', BETTER_AUTH_URL: baseURL },
        },
      }),
});
