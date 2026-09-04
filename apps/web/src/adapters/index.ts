/**
 * The provider platform (F04). Adapters import contracts and nothing else
 * (`docs/02-ARCHITECTURE-CONTRACTS.md` §3) — every side effect arrives through `ports.ts`.
 */
export * from './ports';
export * from './errors';
export * from './retry';
export * from './breaker';
export * from './rate-limit';
export * from './cache-key';
export * from './wrapper';
export * from './fixtures';
export * from './substack';
export * from './market';
export * from './apewisdom';
export * from './sec-edgar';
export * from './marketaux';
export * from './fred';
export * from './x';
export * from './scorer';
