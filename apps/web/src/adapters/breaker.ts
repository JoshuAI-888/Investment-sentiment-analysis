/**
 * The circuit breaker, source §9.4: *"Open a provider circuit for 60 seconds after five
 * consecutive transient failures."*
 *
 * The breaker protects the *collector*, not the provider. Under D-16 the loop must keep
 * turning: a provider that is down should cost one failed call a minute, not a full timeout on
 * every symbol in the universe. Sixty seconds of not asking is the difference between one
 * provider being unavailable and the whole cycle stalling behind it — and a stalled cycle is
 * missing data on every *other* axis too, which no backfill will recover.
 */
import type { ProviderId } from '@/contracts/provider';
import type { BreakerState, BreakerStore, Clock } from './ports';

export const FAILURE_THRESHOLD = 5;
export const OPEN_DURATION_MS = 60_000;

export const closedState: BreakerState = { consecutiveFailures: 0, openedAt: null, probing: false };

export type BreakerVerdict =
  | { allow: true; probe: boolean }
  | { allow: false; openedAt: string };

/**
 * Whether this call may be dispatched.
 *
 * `probe: true` marks the single half-open attempt. It is a flag on the stored state rather
 * than a local variable because the point of half-open is that *one* call finds out — with
 * a hundred symbols in flight, an unguarded half-open sends a hundred requests at a provider
 * that has just been given sixty seconds to recover.
 */
export async function admit(input: {
  provider: ProviderId;
  store: BreakerStore;
  clock: Clock;
}): Promise<BreakerVerdict> {
  const { provider, store, clock } = input;
  const state = (await store.read(provider)) ?? closedState;

  if (state.openedAt === null) return { allow: true, probe: false };

  const openedAtMs = Date.parse(state.openedAt);
  const elapsed = clock.now().getTime() - openedAtMs;

  if (elapsed < OPEN_DURATION_MS) return { allow: false, openedAt: state.openedAt };
  if (state.probing) return { allow: false, openedAt: state.openedAt };

  await store.write(provider, { ...state, probing: true });
  return { allow: true, probe: true };
}

/** A success closes the circuit outright — half-open exists to find exactly this out. */
export async function recordSuccess(input: {
  provider: ProviderId;
  store: BreakerStore;
}): Promise<void> {
  await input.store.write(input.provider, closedState);
}

/**
 * Only *transient* failures count toward the threshold. An entitlement failure is perfectly
 * reproducible, so counting five of them would open a circuit that reopens the moment it
 * closes, and `/api/health/providers` would report a flapping provider when the real answer is
 * a subscription that needs renewing — the one thing the health endpoint should make obvious.
 */
export async function recordFailure(input: {
  provider: ProviderId;
  store: BreakerStore;
  clock: Clock;
  transient: boolean;
}): Promise<BreakerState> {
  const { provider, store, clock, transient } = input;
  const state = (await store.read(provider)) ?? closedState;

  if (!transient) {
    const next: BreakerState = { ...state, probing: false };
    await store.write(provider, next);
    return next;
  }

  const consecutiveFailures = state.consecutiveFailures + 1;
  const shouldOpen = consecutiveFailures >= FAILURE_THRESHOLD || state.openedAt !== null;

  const next: BreakerState = {
    consecutiveFailures,
    openedAt: shouldOpen ? clock.now().toISOString() : null,
    probing: false,
  };

  await store.write(provider, next);
  return next;
}
