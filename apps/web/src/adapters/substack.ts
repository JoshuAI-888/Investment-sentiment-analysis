/**
 * The Substack RSS adapter — F04 §4.3.
 *
 * Chosen first among the six adapters for the reason `MEMORY.md` D-15 names: **zero lead
 * time**. It needs no key and no approval, unlike Reddit (MT-13, still unfiled) or X. Under
 * D-16 collection is forward-only with no backfill, so this is the one channel that can start
 * the clock today. MT-15 (naming the publication set) is resolved and wired — see
 * `./substack-publications.ts` for the confirmed 13-publication list this adapter polls once a
 * dispatcher (F16a) exists to drive it.
 *
 * **Full bodies are retained** (D-17): `contentHtml` is the raw `content:encoded` payload,
 * un-decoded past what XML entity parsing does — Substack wraps it in CDATA precisely so its
 * HTML survives untouched, and re-encoding it here would be lossy in the one direction nobody
 * can undo later.
 */
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import type { ProviderResult } from '@/contracts/provider';
import { createFetcher } from './fixtures';
import type { WrapperDeps } from './wrapper';
import { callProvider } from './wrapper';

export type SubstackEntry = {
  /** `guid` when present, else `link` — Substack's own dedup key (`05-TEST-STRATEGY.md` §2.1). */
  guid: string;
  title: string;
  link: string;
  /** ISO-8601. Parsed from `pubDate`; an unparseable date is a contract violation, not a `null`. */
  publishedAt: string;
  /** Raw `content:encoded` HTML, falling back to `description` when a publication omits it. */
  contentHtml: string;
};

const rawFeedBody = z.string().min(1);

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/** One `<item>` node as `fast-xml-parser` hands it back — shape only, not a validated contract. */
type RawItem = Record<string, unknown>;

function textOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && '#text' in value) {
    const text = (value as { '#text': unknown })['#text'];
    return typeof text === 'string' ? text : null;
  }
  return null;
}

/**
 * Throws on anything that makes the feed unusable as a whole — no channel, unparseable XML.
 * A single bad item does not fail the batch; it is dropped, since one publication's typo
 * should not blind the collector to every other item in the same poll.
 */
export function parseSubstackFeed(xml: string): SubstackEntry[] {
  const parsed: unknown = xmlParser.parse(xml);
  const channel = (parsed as { rss?: { channel?: unknown } }).rss?.channel;
  if (typeof channel !== 'object' || channel === null) {
    throw new Error('feed has no <rss><channel> root — not an RSS 2.0 document');
  }

  const rawItems = (channel as { item?: unknown }).item;
  if (rawItems === undefined) return [];
  const items: RawItem[] = Array.isArray(rawItems) ? (rawItems as RawItem[]) : [rawItems as RawItem];

  const entries: SubstackEntry[] = [];
  for (const item of items) {
    const title = textOf(item.title);
    const link = textOf(item.link);
    const pubDate = textOf(item.pubDate);
    if (title === null || link === null || pubDate === null) continue;

    const publishedAtMs = Date.parse(pubDate);
    if (Number.isNaN(publishedAtMs)) continue;

    const guid = textOf(item.guid) ?? link;
    const contentHtml = textOf(item['content:encoded']) ?? textOf(item.description) ?? '';

    entries.push({
      guid,
      title,
      link,
      publishedAt: new Date(publishedAtMs).toISOString(),
      contentHtml,
    });
  }
  return entries;
}

export async function fetchSubstackFeed(
  options: {
    /** The `<publication>` in `https://<publication>.substack.com/feed` (source §4.3). */
    publicationSlug: string;
    cacheTtlMs?: number;
    maxStaleMs?: number;
    /**
     * Extra request headers. Real polls need none; contract tests use this to set
     * `x-fixture-case` (`./fixtures.ts`) and select which recorded response to exercise.
     */
    headers?: Readonly<Record<string, string>>;
  },
  providerMode: 'fixture' | 'live',
  deps: Omit<WrapperDeps, 'fetcher'> & { fixturesRoot?: string },
): Promise<ProviderResult<SubstackEntry[]>> {
  const fetcher = createFetcher(providerMode, {
    provider: 'substack',
    endpoint: 'feed',
    ...(deps.fixturesRoot === undefined ? {} : { root: deps.fixturesRoot }),
  });

  const result = await callProvider(
    {
      provider: 'substack',
      operation: 'feed',
      segments: [options.publicationSlug],
      schema: rawFeedBody,
      request: {
        url: `https://${options.publicationSlug}.substack.com/feed`,
        ...(options.headers === undefined ? {} : { headers: options.headers }),
      },
      // Unpriced: RSS is a flat, free poll (source §4.3's cost-shape table).
      estimatedCostUsd: null,
      ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
      ...(options.maxStaleMs === undefined ? {} : { maxStaleMs: options.maxStaleMs }),
    },
    { ...deps, fetcher },
  );

  if (!result.ok) return result;

  try {
    return { ok: true, data: parseSubstackFeed(result.data), meta: result.meta };
  } catch (thrown) {
    // Stage 8 in spirit, run a layer up: the wrapper's schema only proves "this is a non-empty
    // string," since XML has no zod-checkable shape at that point. A feed that fails to parse
    // as RSS at all means the publication changed its feed format, which is exactly the "loud"
    // condition F04 §4.1 stage 8 exists for.
    const issues = [thrown instanceof Error ? thrown.message : String(thrown)];
    deps.onContractViolation({ provider: 'substack', endpoint: 'feed', issues, payloadRef: null });
    return { ok: false, error: { kind: 'contract', issues }, meta: result.meta };
  }
}
