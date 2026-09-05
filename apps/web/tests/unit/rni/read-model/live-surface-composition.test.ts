import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const livePages = [
  'app/(rni)/rni/page.tsx',
  'app/(rni)/rni/security/nvda/page.tsx',
  'app/(rni)/rni/explorer/nvda/page.tsx',
  'app/(rni)/rni/status/page.tsx',
  'app/(rni)/rni/refresh/page.tsx',
  'app/(rni)/rni/settings/universe/page.tsx',
  'app/(rni)/rni/settings/ai-route/page.tsx',
] as const;

const fixturePages = [
  'app/(rni)/rni/fixture/page.tsx',
  'app/(rni)/rni/fixture/security/nvda/page.tsx',
  'app/(rni)/rni/fixture/explorer/nvda/page.tsx',
  'app/(rni)/rni/fixture/status/page.tsx',
  'app/(rni)/rni/fixture/settings/universe/page.tsx',
  'app/(rni)/rni/fixture/settings/ai-route/page.tsx',
  'app/(rni)/rni/refresh/fixture/page.tsx',
  'app/(rni)/rni/settings/ai-route/fixture/page.tsx',
] as const;

const source = (path: string) => readFile(new URL(`../../../../${path}`, import.meta.url), 'utf8');

describe('RNI live surface composition', () => {
  it.each(livePages)('%s is authenticated and contains no fixture composition', async (path) => {
    const contents = await source(path);
    expect(contents).toMatch(/require(?:User|Admin)\(\)/u);
    expect(contents).not.toMatch(/fixtures\/rni-ui|createFixtureRni|rniFixtureIds|referenceRadarPage/u);
  });

  it.each(fixturePages)('%s is guarded by the validated fixture-only boundary', async (path) => {
    const contents = await source(path);
    expect(contents).toContain('renderFixtureOnly(env.PROVIDER_MODE');
    expect(contents).toContain('FixtureRouteUnavailableError');
  });

  it('the production refresh control has no implicit fixture service', async () => {
    const contents = await source('src/rni/ui/ManualRefreshControls.tsx');
    expect(contents).toContain("fetch('/api/rni/runs'");
    expect(contents).not.toMatch(/FixtureRni|fixtures\/rni-ui/u);
  });
});
