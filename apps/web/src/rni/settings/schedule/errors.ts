export class RniScheduleSettingsError extends Error {
  constructor(readonly kind: 'invalid' | 'conflict' | 'unavailable') {
    super(`RNI schedule settings ${kind}`);
    this.name = 'RniScheduleSettingsError';
  }
}
