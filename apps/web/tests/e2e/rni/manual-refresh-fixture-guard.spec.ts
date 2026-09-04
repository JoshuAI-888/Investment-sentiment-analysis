import { expect, test } from '@playwright/test';
import { FixtureRouteUnavailableError, renderFixtureOnly } from '@/rni/ui/renderFixtureOnly';

test('RNI refresh fixture page renders only in fixture runtime mode', () => {
  expect(renderFixtureOnly('fixture', () => 'fixture-harness')).toBe('fixture-harness');
  let renderedInLiveMode = false;
  expect(() =>
    renderFixtureOnly('live', () => {
      renderedInLiveMode = true;
      return 'fixture-harness';
    }),
  ).toThrow(FixtureRouteUnavailableError);
  expect(renderedInLiveMode).toBe(false);
});
