import type { RniErrorCode } from '../contracts';

/** Stable errors are safe for the authenticated composition root to map to HTTP. */
export class RniReadError extends Error {
  constructor(readonly code: RniErrorCode) {
    super(code);
    this.name = 'RniReadError';
  }
}
