export class FixtureRouteUnavailableError extends Error {
  constructor() {
    super('RNI fixture UI is unavailable outside fixture mode');
    this.name = 'FixtureRouteUnavailableError';
  }
}

/** Executes browser-fixture UI only when the validated runtime mode permits it. */
export function renderFixtureOnly<T>(providerMode: 'fixture' | 'live', render: () => T): T {
  if (providerMode !== 'fixture') throw new FixtureRouteUnavailableError();
  return render();
}
