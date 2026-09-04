import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * F21 §5 e2e row: "A host session: ask about a ticker, receive a rendered component, open the
 * calculation, reach the Inspector artifact." Simulated here as a signed-in JSON-RPC session
 * against `POST /api/mcp` — the same auth cookie an interactive Playwright session already
 * carries after sign-in (`page.request` shares the browser context's cookie jar), which is the
 * closest this test harness can get to a real MCP host without standing up one.
 *
 * Ticker data is seeded through `/api/ticker/e2e-seed` (`services/ticker/testing.ts`), the same
 * fixture-mode seed `ticker.spec.ts` (F09) already uses — no social/attention collector is wired
 * to this environment, so this is the only deterministic way to get a computable reading.
 */

const PASSWORD = 'correct horse battery staple';

async function readFixtureLink(request: APIRequestContext, email: string): Promise<string> {
  const deadline = Date.now() + 2000;
  let lastUrl: string | null = null;
  while (Date.now() < deadline) {
    const response = await request.get(`/api/auth/fixture-link?email=${encodeURIComponent(email)}`);
    const body = (await response.json()) as { url: string | null };
    lastUrl = body.url;
    if (lastUrl !== null) return lastUrl;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(lastUrl, `no fresh verification link was ever recorded for ${email}`).not.toBeNull();
  return lastUrl as string;
}

async function signUpAndVerify(page: Page, request: APIRequestContext, email: string): Promise<void> {
  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/Check your email/)).toBeVisible();
  const verifyUrl = await readFixtureLink(request, email);
  await page.goto(verifyUrl);
  await page.goto('/dashboard');
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
}

async function seed(request: APIRequestContext, action: 'full' | 'ambiguous' | 'empty' | 'ineligible'): Promise<{ symbol: string }> {
  const response = await request.post('/api/ticker/e2e-seed', { data: { action } });
  expect(response.status(), 'the e2e-seed route only answers in fixture mode').toBe(200);
  return (await response.json()) as { symbol: string };
}

type JsonRpcResult = { jsonrpc: '2.0'; id: number; result?: unknown; error?: { code: number; message: string } };

async function rpc(request: APIRequestContext, method: string, params?: unknown): Promise<JsonRpcResult> {
  const response = await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method, params } });
  expect(response.status(), `${method} should return 200 for a signed-in caller`).toBe(200);
  return (await response.json()) as JsonRpcResult;
}

test.describe('F21 — MCP server: unauthenticated caller', () => {
  test('POST /api/mcp is refused with 401 before any tool runs', async ({ request }) => {
    const response = await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    expect(response.status()).toBe(401);
  });
});

test.describe('F21 — MCP server: signed-in session, the full DoD e2e row', () => {
  test.skip(process.env['DATABASE_URL'] === undefined, 'needs DATABASE_URL — see this feature CONTRACTS report');
  test.describe.configure({ mode: 'serial' });
  const email = 'e2e-mcp@example.com';

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signUpAndVerify(page, context.request, email);
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    await signIn(page, email);
  });

  test('ask about a ticker, receive a rendered component, open the calculation, reach the Inspector artifact', async ({ page }) => {
    const { symbol } = await seed(page.request, 'full');

    // 1. "Ask about a ticker" — the primary read tool.
    const sentiment = await rpc(page.request, 'tools/call', { name: 'get_ticker_sentiment', arguments: { symbol } });
    expect(sentiment.error).toBeUndefined();
    const sentimentResult = sentiment.result as { content: { type: string; text: string }[]; isError: boolean };
    expect(sentimentResult.isError).toBe(false);
    const envelope = JSON.parse(sentimentResult.content[0]?.text ?? '{}') as {
      ok: boolean;
      calculationIds: string[];
      mustNotClaim: string[];
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.calculationIds.length).toBeGreaterThan(0);
    expect(envelope.mustNotClaim.length).toBeGreaterThan(0);
    const calculationId = envelope.calculationIds[0] as string;

    // 2. "Receive a rendered component" — the metric-card ui:// resource, disclosure in markup.
    const cardRead = await rpc(page.request, 'resources/read', { uri: `ui://metric-card?calculationId=${calculationId}` });
    expect(cardRead.error).toBeUndefined();
    const cardContents = (cardRead.result as { contents: { text: string }[] }).contents;
    expect(cardContents[0]?.text).toContain('This is a description of what is currently observable.');

    // 3. "Open the calculation" — open_calculation resolves the same id.
    const opened = await rpc(page.request, 'tools/call', { name: 'open_calculation', arguments: { calculationId } });
    const openedResult = opened.result as { content: { text: string }[]; isError: boolean };
    expect(openedResult.isError).toBe(false);
    const openedEnvelope = JSON.parse(openedResult.content[0]?.text ?? '{}') as { ok: boolean; data: { calculationId: string } };
    expect(openedEnvelope.ok).toBe(true);
    expect(openedEnvelope.data.calculationId).toBe(calculationId);

    // 4. "Reach the Inspector artifact" — the ui://inspector resource for the same id.
    const inspectorRead = await rpc(page.request, 'resources/read', { uri: `ui://inspector?calculationId=${calculationId}` });
    expect(inspectorRead.error).toBeUndefined();
    const inspectorContents = (inspectorRead.result as { contents: { text: string }[] }).contents;
    expect(inspectorContents[0]?.text).toContain('data-role="input-hash"');
  });

  test('the corpus-leak discipline holds end to end: list_supporting_evidence never returns a raw dump', async ({ page }) => {
    const { symbol } = await seed(page.request, 'full');
    const response = await rpc(page.request, 'tools/call', { name: 'list_supporting_evidence', arguments: { symbol } });
    const result = response.result as { content: { text: string }[] };
    const envelope = JSON.parse(result.content[0]?.text ?? '{}') as { ok: boolean; data: { items: unknown[] } };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.items.length).toBeLessThanOrEqual(30);
  });
});
