export class RniAiRouteSettingsError extends Error {
  constructor(readonly kind: 'invalid' | 'conflict' | 'unavailable') {
    super(`RNI AI route settings ${kind}`);
    this.name = 'RniAiRouteSettingsError';
  }
}
