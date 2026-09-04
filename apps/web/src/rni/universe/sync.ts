import { z } from 'zod';
import type { ProviderError, ProviderMeta } from '../../contracts/provider';
import { providerError } from '../../contracts/provider';
import { universeVersion } from '../../contracts/config';
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
  claimCommand(input: FmpUniverseSyncRequest): Promise<
    | { readonly state: 'claimed' }
    | { readonly state: 'running' }
    | { readonly state: 'completed'; readonly result: unknown }
    | { readonly state: 'failed'; readonly errorMessage: string }
  >;
  waitForCommand(input: FmpUniverseSyncRequest): Promise<
    | { readonly state: 'completed'; readonly result: unknown }
    | { readonly state: 'failed'; readonly errorMessage: string }
  >;
  completeCommand(input: {
    readonly command: FmpUniverseSyncRequest;
    readonly result: FmpUniverseSyncResult;
    readonly auditResult: 'success' | 'failure';
    readonly providerCallId: string;
    readonly sourcePayloadHash: string | null;
    readonly universeVersionId: string | null;
  }): Promise<void>;
  failCommand(input: {
    readonly command: FmpUniverseSyncRequest;
    readonly errorMessage: string;
    readonly providerCallId: string | null;
    readonly sourcePayloadHash: string | null;
  }): Promise<void>;
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

export type FmpUniverseSyncRequest = {
  readonly environment: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
};

const validationIssue = z.discriminatedUnion('code', [
  z.object({ code: z.literal('partial_payload'), count: z.number().int() }),
  z.object({ code: z.literal('over_ceiling'), count: z.number().int() }),
  z.object({ code: z.literal('duplicate_symbol'), symbols: z.array(z.string()) }),
  z.object({ code: z.literal('missing_nvda') }),
  z.object({ code: z.literal('invalid_first_added_at'), symbols: z.array(z.string()) }),
  z.object({ code: z.literal('unresolved_symbol'), symbols: z.array(z.string()) }),
  z.object({ code: z.literal('ambiguous_symbol'), symbols: z.array(z.string()) }),
]);

const storedSyncResult = z.union([
  z.object({
    ok: z.literal(true),
    staged: z.object({
      version: universeVersion,
      memberCount: z.number().int().nonnegative(),
      reused: z.boolean(),
      impactPreview: z.object({
        addedSecurityIds: z.array(z.string().uuid()),
        removedSecurityIds: z.array(z.string().uuid()),
      }),
    }),
  }),
  z.object({ ok: z.literal(false), kind: z.literal('provider'), error: providerError }),
  z.object({
    ok: z.literal(false),
    kind: z.literal('invalid_snapshot'),
    issues: z.array(validationIssue),
  }),
]);

function replayResult(
  claim:
    | { readonly state: 'completed'; readonly result: unknown }
    | { readonly state: 'failed'; readonly errorMessage: string },
): FmpUniverseSyncResult {
  if (claim.state === 'failed') {
    throw new Error(`Prior FMP universe synchronization failed: ${claim.errorMessage}`);
  }
  return storedSyncResult.parse(claim.result);
}

export async function synchronizeFmpUniverse(
  input: FmpUniverseSyncRequest,
  deps: FmpUniverseSyncDeps,
): Promise<FmpUniverseSyncResult> {
  const claim = await deps.claimCommand(input);
  if (claim.state === 'completed' || claim.state === 'failed') return replayResult(claim);
  if (claim.state === 'running') return replayResult(await deps.waitForCommand(input));

  let providerCallId: string | null = null;
  let sourcePayloadHash: string | null = null;
  try {
    const fetched = await deps.fetchConstituents();
    providerCallId = fetched.providerCallId;
    if (!fetched.ok) {
      const result: FmpUniverseSyncResult = {
        ok: false,
        kind: 'provider',
        error: fetched.error,
      };
      await deps.completeCommand({
        command: input,
        result,
        auditResult: 'failure',
        providerCallId: fetched.providerCallId,
        sourcePayloadHash: null,
        universeVersionId: null,
      });
      return result;
    }

    sourcePayloadHash = fetched.data.payloadSha256;
    const securities = await deps.listSecurities();
    const validated = validateAndResolveFmpUniverse({
      constituents: fetched.data.constituents,
      securities,
      retrievedAt: fetched.meta.requestedAt,
      payloadSha256: fetched.data.payloadSha256,
    });
    if (!validated.ok) {
      const result: FmpUniverseSyncResult = {
        ok: false,
        kind: 'invalid_snapshot',
        issues: validated.issues,
      };
      await deps.completeCommand({
        command: input,
        result,
        auditResult: 'failure',
        providerCallId: fetched.providerCallId,
        sourcePayloadHash: fetched.data.payloadSha256,
        universeVersionId: null,
      });
      return result;
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
    const result: FmpUniverseSyncResult = { ok: true, staged };
    await deps.completeCommand({
      command: input,
      result,
      auditResult: 'success',
      providerCallId: fetched.providerCallId,
      sourcePayloadHash: fetched.data.payloadSha256,
      universeVersionId: staged.version.id,
    });
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unexpected universe sync error';
    await deps.failCommand({
      command: input,
      errorMessage,
      providerCallId,
      sourcePayloadHash,
    });
    throw error;
  }
}
