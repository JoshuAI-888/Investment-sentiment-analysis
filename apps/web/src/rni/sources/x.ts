import { createHash } from 'node:crypto';
import { z } from 'zod';
import { fetchRecentSearch } from '@/adapters/x';
import type { XPost } from '@/adapters/x';
import type { ProviderError } from '@/contracts/provider';
import type {
  RejectedXPost,
  XAdapterPort,
  XConfiguredQuery,
  XQueryTrace,
  XSourceCandidate,
  XSourceClock,
  XSourceRetrieval,
  XSourceSliceRequest,
  XSourceSliceResult,
} from './types';

const xSourceSliceRequest = z
  .object({
    runId: z.string().uuid(),
    sliceId: z.string().uuid(),
    windowStart: z.string().datetime({ offset: true }),
    windowEnd: z.string().datetime({ offset: true }),
    queries: z
      .array(
        z
          .object({
            queryId: z.string().uuid(),
            query: z.string().trim().min(1),
            scope: z.string().trim().min(1),
            maxResults: z.number().int().min(10).max(100).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Date(request.windowEnd).getTime() <= new Date(request.windowStart).getTime()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['windowEnd'],
        message: 'windowEnd must be after windowStart',
      });
    }
    if (new Set(request.queries.map(({ queryId }) => queryId)).size !== request.queries.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['queries'],
        message: 'queryId values must be unique',
      });
    }
  });

const systemClock: XSourceClock = { now: () => new Date() };
const unavailableErrorKinds: ReadonlySet<ProviderError['kind']> = new Set([
  'entitlement',
  'quota',
  'budget_denied',
  'circuit_open',
]);

type ExistingXAdapter = typeof fetchRecentSearch;
type ExistingXAdapterDeps = Parameters<ExistingXAdapter>[2];

export type ExistingXAdapterPortOptions = {
  providerMode: 'fixture' | 'live';
  bearerToken?: string;
  cacheTtlMs?: number;
  maxStaleMs?: number;
  headers?: Readonly<Record<string, string>>;
  deps: ExistingXAdapterDeps;
};

export function createExistingXAdapterPort(
  options: ExistingXAdapterPortOptions,
  adapter: ExistingXAdapter = fetchRecentSearch,
): XAdapterPort {
  if (
    options.providerMode === 'live' &&
    (options.bearerToken === undefined || options.bearerToken.length === 0)
  ) {
    throw new Error('createExistingXAdapterPort: bearerToken is required in live mode');
  }
  return {
    async search(request) {
      return adapter(
        {
          query: request.query,
          ...(request.maxResults === undefined ? {} : { maxResults: request.maxResults }),
          ...(options.bearerToken === undefined ? {} : { bearerToken: options.bearerToken }),
          ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
          ...(options.maxStaleMs === undefined ? {} : { maxStaleMs: options.maxStaleMs }),
          ...(options.headers === undefined ? {} : { headers: options.headers }),
        },
        options.providerMode,
        options.deps,
      );
    },
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function xPostUrl(externalId: string): string {
  return `https://x.com/i/web/status/${encodeURIComponent(externalId)}`;
}

function normalizeAuthorHandle(authorUsername: string | null): string | null {
  const normalized = authorUsername?.trim().toLowerCase();
  return normalized === undefined || normalized.length === 0 ? null : sha256(normalized);
}

function isWholePageHtml(value: string): boolean {
  return /<!doctype\s+html|<html(?:\s|>)/iu.test(value);
}

function reject(
  queryId: string,
  externalId: string,
  reason: RejectedXPost['reason'],
): RejectedXPost {
  return { queryId, externalId, reason };
}

function normalizePost(
  post: XPost,
  query: Pick<XConfiguredQuery, 'queryId' | 'scope'>,
  windowStartMs: number,
  windowEndMs: number,
): Omit<XSourceCandidate, 'retrievals'> | RejectedXPost {
  if (post.createdAt === null) return reject(query.queryId, post.id, 'PUBLISHED_AT_MISSING');
  const publishedAtMs = new Date(post.createdAt).getTime();
  if (!Number.isFinite(publishedAtMs)) {
    return reject(query.queryId, post.id, 'PUBLISHED_AT_INVALID');
  }
  if (publishedAtMs < windowStartMs || publishedAtMs >= windowEndMs) {
    return reject(query.queryId, post.id, 'OUTSIDE_WINDOW');
  }
  if (post.text.trim().length === 0) {
    return reject(query.queryId, post.id, 'NO_ANALYZABLE_CONTENT');
  }
  if (post.text.length > 20_000) {
    return reject(query.queryId, post.id, 'CONTENT_TOO_LONG');
  }
  if (isWholePageHtml(post.text)) {
    return reject(query.queryId, post.id, 'WHOLE_PAGE_HTML');
  }

  const url = xPostUrl(post.id);
  return {
    originalUrl: url,
    canonicalUrl: url,
    externalId: post.id,
    sourceKind: 'x_post',
    subredditOrScope: query.scope,
    title: null,
    authorHandleHash: normalizeAuthorHandle(post.authorUsername),
    boundedContent: post.text,
    contentSha256: sha256(post.text),
    captureMode: 'full_post',
    publishedAt: new Date(publishedAtMs).toISOString(),
    publicationTimeVerified: true,
    lang: post.lang,
    metrics: post.metrics,
    primaryQueryId: query.queryId,
    matchedQueryIds: [query.queryId],
    previousContentSha256: null,
  };
}

function isCandidate(
  value: Omit<XSourceCandidate, 'retrievals'> | RejectedXPost,
): value is Omit<XSourceCandidate, 'retrievals'> {
  return 'canonicalUrl' in value;
}

function terminalFailureStatus(traces: readonly XQueryTrace[]): 'failed' | 'unavailable' {
  const failureKinds = traces.map(({ errorKind }) => errorKind);
  return failureKinds.every(
    (kind) => kind !== null && kind !== 'unexpected_throw' && unavailableErrorKinds.has(kind),
  )
    ? 'unavailable'
    : 'failed';
}

export async function runXSourceSlice(
  input: XSourceSliceRequest,
  port: XAdapterPort,
  clock: XSourceClock = systemClock,
): Promise<XSourceSliceResult> {
  const request = xSourceSliceRequest.parse(input);
  const attemptedAt = clock.now().toISOString();
  const windowStartMs = new Date(request.windowStart).getTime();
  const windowEndMs = new Date(request.windowEnd).getTime();
  const candidatesByVersion = new Map<string, XSourceCandidate>();
  const latestCandidateById = new Map<string, XSourceCandidate>();
  const rejectedPosts: RejectedXPost[] = [];
  const queryTraces: XQueryTrace[] = [];
  let duplicatePostCount = 0;
  let changedContentVersionCount = 0;
  let successfulQueryCount = 0;
  let integrityRejectionCount = 0;

  for (const query of request.queries) {
    let result: Awaited<ReturnType<XAdapterPort['search']>>;
    try {
      result = await port.search({
        query: query.query,
        ...(query.maxResults === undefined ? {} : { maxResults: query.maxResults }),
      });
    } catch {
      queryTraces.push({
        queryId: query.queryId,
        ok: false,
        returnedPostCount: 0,
        providerMeta: null,
        errorKind: 'unexpected_throw',
      });
      continue;
    }
    if (!result.ok) {
      queryTraces.push({
        queryId: query.queryId,
        ok: false,
        returnedPostCount: 0,
        providerMeta: result.meta,
        errorKind: result.error.kind,
      });
      continue;
    }

    successfulQueryCount += 1;
    queryTraces.push({
      queryId: query.queryId,
      ok: true,
      returnedPostCount: result.data.length,
      providerMeta: result.meta,
      errorKind: null,
    });
    for (const [postIndex, post] of result.data.entries()) {
      const normalized = normalizePost(post, query, windowStartMs, windowEndMs);
      if (!isCandidate(normalized)) {
        rejectedPosts.push(normalized);
        if (normalized.reason !== 'OUTSIDE_WINDOW') integrityRejectionCount += 1;
        continue;
      }
      const retrieval: XSourceRetrieval = {
        queryId: query.queryId,
        query: query.query,
        retrievedAt: result.meta.requestedAt,
        rank: postIndex + 1,
        providerMeta: result.meta,
        captureMode: 'full_post',
        sourceMetadata: {
          subredditOrScope: normalized.subredditOrScope,
          authorHandleHash: normalized.authorHandleHash,
          publishedAt: normalized.publishedAt,
          lang: normalized.lang,
          metrics: normalized.metrics,
          contentSha256: normalized.contentSha256,
        },
      };
      const versionKey = `${normalized.externalId}\u0000${normalized.contentSha256}`;
      const existingVersion = candidatesByVersion.get(versionKey);
      if (existingVersion !== undefined) {
        duplicatePostCount += 1;
        const updatedVersion: XSourceCandidate = {
          ...existingVersion,
          subredditOrScope: normalized.subredditOrScope,
          authorHandleHash: normalized.authorHandleHash ?? existingVersion.authorHandleHash,
          publishedAt: normalized.publishedAt,
          lang: normalized.lang ?? existingVersion.lang,
          metrics: normalized.metrics,
          matchedQueryIds: existingVersion.matchedQueryIds.includes(query.queryId)
            ? existingVersion.matchedQueryIds
            : [...existingVersion.matchedQueryIds, query.queryId],
          retrievals: [...existingVersion.retrievals, retrieval],
        };
        candidatesByVersion.set(versionKey, updatedVersion);
        if (
          latestCandidateById.get(normalized.externalId)?.contentSha256 ===
          normalized.contentSha256
        ) {
          latestCandidateById.set(normalized.externalId, updatedVersion);
        }
        continue;
      }
      const previousVersion = latestCandidateById.get(normalized.externalId);
      const candidate = {
        ...normalized,
        retrievals: [retrieval],
        previousContentSha256: previousVersion?.contentSha256 ?? null,
      };
      if (previousVersion !== undefined) {
        changedContentVersionCount += 1;
      }
      candidatesByVersion.set(versionKey, candidate);
      latestCandidateById.set(normalized.externalId, candidate);
    }
  }

  const candidates = [...candidatesByVersion.values()];
  if (successfulQueryCount === 0) {
    const status = terminalFailureStatus(queryTraces);
    return {
      slice: {
        id: request.sliceId,
        runId: request.runId,
        platform: 'x',
        status,
        eligibleSourceCount: 0,
        coverageDisclosure: 'Configured X sample unavailable; no Reddit fallback was used.',
        lastAttemptAt: attemptedAt,
        lastSuccessfulRefreshAt: null,
        dataThroughAt: null,
        computedAt: null,
        errorCode: status === 'unavailable' ? 'X_PROVIDER_UNAVAILABLE' : 'X_PROVIDER_FAILED',
      },
      candidates,
      rejectedPosts,
      duplicatePostCount,
      changedContentVersionCount,
      queryTraces,
    };
  }

  const isPartial =
    successfulQueryCount !== request.queries.length || integrityRejectionCount > 0;
  const dataThroughAt = candidates.reduce<string | null>(
    (latest, candidate) =>
      latest === null || candidate.publishedAt > latest ? candidate.publishedAt : latest,
    null,
  );
  return {
    slice: {
      id: request.sliceId,
      runId: request.runId,
      platform: 'x',
      status: isPartial ? 'partial' : 'complete',
      eligibleSourceCount: latestCandidateById.size,
      coverageDisclosure:
        latestCandidateById.size === 0
          ? 'Configured X adapter sample completed with no eligible in-window posts; no platform-wide completeness is claimed.'
          : 'Configured X adapter sample only; no platform-wide completeness is claimed.',
      lastAttemptAt: attemptedAt,
      lastSuccessfulRefreshAt: attemptedAt,
      dataThroughAt,
      computedAt: null,
      errorCode: isPartial ? 'X_SOURCE_PARTIAL' : null,
    },
    candidates,
    rejectedPosts,
    duplicatePostCount,
    changedContentVersionCount,
    queryTraces,
  };
}
