/**
 * The domain vocabulary. Everything depends on this; it depends on nothing
 * (`docs/02-ARCHITECTURE-CONTRACTS.md` §3).
 *
 * **SPINE owns this directory.** A contract change wanted by another lane arrives as a request
 * to the coordinator and is built here — never edited in place by the lane that wants it.
 */
export * from './primitives';
export * from './security';
export * from './evidence';
export * from './calculation';
export * from './research';
export * from './config';
export * from './operations';
export * from './cost';
export * from './provider';
