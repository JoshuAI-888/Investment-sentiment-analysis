import { fetchFmpSp500Constituents } from '../../adapters/fmp-universe';
import { systemClock } from '../../adapters/ports';
import type {
  BreakerState,
  CacheEntry,
  CallLogEntry,
  RateLimiterState,
} from '../../adapters/ports';
import type { WrapperDeps } from '../../adapters/wrapper';
import type { ProviderId } from '../../contracts/provider';
import { env } from '../../env';
import { listActiveSecurities } from '../../repositories/security';
import {
  claimUniverseSyncCommand,
  completeUniverseSyncCommand,
  failUniverseSyncCommand,
  insertUniverseProviderCall,
  stageAndCompleteFmpUniverseCommand,
} from '../../repositories/versions';
import { synchronizeFmpUniverse, type FmpUniverseSyncResult } from './sync';

function wrapperDeps(
  onCallLog: (entry: CallLogEntry) => Promise<void>,
): Omit<WrapperDeps, 'fetcher'> {
  const cache = new Map<string, CacheEntry>();
  const breakers = new Map<ProviderId, BreakerState>();
  const rateLimits = new Map<ProviderId, RateLimiterState>();
  return {
    clock: systemClock,
    cache: {
      get: async (key) => cache.get(key) ?? null,
      set: async (key, value) => {
        cache.set(key, value);
      },
    },
    quota: {
      reserve: async () => ({ granted: true, remaining: null }),
      release: async () => {},
    },
    budget: { check: async () => ({ allowed: true }) },
    breaker: {
      read: async (provider) => breakers.get(provider) ?? null,
      write: async (provider, state) => {
        breakers.set(provider, state);
      },
    },
    rateLimiter: {
      read: async (provider) => rateLimits.get(provider) ?? null,
      write: async (provider, state) => {
        rateLimits.set(provider, state);
      },
    },
    callLog: onCallLog,
    cost: async () => {},
    onContractViolation: () => {},
  };
}

export async function syncFmpUniverseFromEnvironment(input: {
  readonly environment: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}): Promise<FmpUniverseSyncResult> {
  return synchronizeFmpUniverse(input, {
    claimCommand: (command) => claimUniverseSyncCommand(command),
    completeCommand: (command) => completeUniverseSyncCommand(command),
    failCommand: (command) => failUniverseSyncCommand(command),
    fetchConstituents: async () => {
      let providerCallId: string | null = null;
      const deps = wrapperDeps(async (entry) => {
        providerCallId = await insertUniverseProviderCall(entry);
      });
      const result = await fetchFmpSp500Constituents(
        { ...(env.FMP_API_KEY === undefined ? {} : { apiKey: env.FMP_API_KEY }) },
        env.PROVIDER_MODE,
        deps,
      );
      if (providerCallId === null) {
        throw new Error(
          'FMP universe call completed without a persisted provider_call_log identity',
        );
      }
      return { ...result, providerCallId };
    },
    listSecurities: () => listActiveSecurities(),
    stageAndComplete: (stageInput) => stageAndCompleteFmpUniverseCommand(stageInput),
  });
}
