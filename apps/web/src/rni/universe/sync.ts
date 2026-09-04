import type { ProviderError, ProviderMeta } from '../../contracts/provider';
import type { FmpSp500Payload } from '../../adapters/fmp-universe';
import type {
  StageFmpUniverseInput,
  StageFmpUniverseOutcome,
} from '../../repositories/versions';
import {
  validateAndResolveFmpUniverse,
  type FmpUniverseValidationIssue,
  type UniverseSecurity,
} from './validate';

export type FmpUniverseFetchResult =
  | {
      readonly ok: true;
      readonly data: FmpSp500Payload;
      readonly meta: ProviderMeta;
      readonly providerCallId: string;
    }
  | {
      readonly ok: false;
      readonly error: ProviderError;
      readonly meta: ProviderMeta;
      readonly providerCallId: string;
    };

export type FmpUniverseSyncDeps = {
  fetchConstituents(): Promise<FmpUniverseFetchResult>;
  listSecurities(): Promise<readonly UniverseSecurity[]>;
  stage(input: StageFmpUniverseInput): Promise<StageFmpUniverseOutcome>;
};

export type FmpUniverseSyncResult =
  | { readonly ok: true; readonly staged: StageFmpUniverseOutcome }
  | { readonly ok: false; readonly kind: 'provider'; readonly error: ProviderError }
  | {
      readonly ok: false;
      readonly kind: 'invalid_snapshot';
      readonly issues: readonly FmpUniverseValidationIssue[];
    };

export async function synchronizeFmpUniverse(
  input: {
    readonly environment: string;
    readonly actorId: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  },
  deps: FmpUniverseSyncDeps,
): Promise<FmpUniverseSyncResult> {
  const fetched = await deps.fetchConstituents();
  if (!fetched.ok) return { ok: false, kind: 'provider', error: fetched.error };

  const securities = await deps.listSecurities();
  const validated = validateAndResolveFmpUniverse({
    constituents: fetched.data.constituents,
    securities,
    retrievedAt: fetched.meta.requestedAt,
    payloadSha256: fetched.data.payloadSha256,
  });
  if (!validated.ok) {
    return { ok: false, kind: 'invalid_snapshot', issues: validated.issues };
  }

  const staged = await deps.stage({
    environment: input.environment,
    sourceRetrievedAt: validated.snapshot.retrievedAt,
    sourcePayloadHash: validated.snapshot.payloadSha256,
    providerCallId: fetched.providerCallId,
    members: validated.members,
    actorId: input.actorId,
    requestId: input.idempotencyKey,
    correlationId: input.correlationId,
  });
  return { ok: true, staged };
}
