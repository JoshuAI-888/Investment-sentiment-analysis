import { z } from 'zod';
import { rniSecurityMention } from '@/rni/contracts';
import type {
  RniMentionIdFactory,
  RniSecurityResolutionRequest,
  RniSecurityResolutionResult,
  RniUnresolvedSecuritySpan,
} from './types';

const candidateSchema = z
  .object({
    id: z.string().uuid(),
    symbol: z.string().regex(/^[A-Za-z][A-Za-z0-9.-]{0,9}$/u),
    name: z.string().min(1),
    exchange: z.string().min(1),
    aliases: z.array(z.string().min(1)),
    active: z.boolean(),
  })
  .strict();

const requestSchema = z
  .object({
    sourceItemId: z.string().uuid(),
    boundedContent: z.string().min(1).max(20_000),
    candidates: z.array(candidateSchema),
    ambiguityPolicy: z
      .object({
        version: z.string().min(1),
        bareTickerSymbols: z
          .array(z.string().regex(/^[A-Z][A-Z0-9.-]{0,9}$/u))
          .refine((symbols) => new Set(symbols).size === symbols.length, {
            message: 'Bare-ticker ambiguity policy cannot contain duplicate symbols',
          }),
      })
      .strict(),
  })
  .strict();

type Candidate = z.infer<typeof candidateSchema>;
type Detection = {
  readonly security: Candidate;
  readonly start: number;
  readonly end: number;
  readonly method: 'exact_ticker' | 'company_alias';
};

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}_]/u.test(value);
}

function exactSpans(content: string, needle: string, caseSensitive: boolean): Array<{
  start: number;
  end: number;
}> {
  if (needle === '') return [];
  const spans: Array<{ start: number; end: number }> = [];
  const matcher = caseSensitive
    ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu')
    : new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'giu');
  for (const match of content.matchAll(matcher)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!isWordCharacter(content[start - 1]) && !isWordCharacter(content[end])) {
      spans.push({ start, end });
    }
  }
  return spans;
}

function tickerDetections(content: string, security: Candidate): Detection[] {
  const symbol = security.symbol.toUpperCase();
  const detections: Detection[] = [];
  for (const span of exactSpans(content, `$${symbol}`, false)) {
    detections.push({ security, ...span, method: 'exact_ticker' });
  }
  for (const span of exactSpans(content, symbol, true)) {
    if (content[span.start - 1] === '$') continue;
    detections.push({ security, ...span, method: 'exact_ticker' });
  }
  return detections;
}

function aliasDetections(content: string, security: Candidate): Detection[] {
  const symbol = security.symbol.toLocaleLowerCase('en-US');
  const aliases = new Set([security.name, ...security.aliases]);
  const detections: Detection[] = [];
  for (const alias of aliases) {
    const trimmed = alias.trim();
    if (trimmed === '' || trimmed.toLocaleLowerCase('en-US') === symbol) continue;
    for (const span of exactSpans(content, trimmed, false)) {
      detections.push({ security, ...span, method: 'company_alias' });
    }
  }
  return detections;
}

function detectionKey(detection: Pick<Detection, 'start' | 'end'>): string {
  return `${detection.start}:${detection.end}`;
}

function unresolved(
  content: string,
  detection: Pick<Detection, 'start' | 'end'>,
  reason: RniUnresolvedSecuritySpan['reason'],
  candidates: readonly Detection[],
): RniUnresolvedSecuritySpan {
  return {
    mentionText: content.slice(detection.start, detection.end),
    startOffset: detection.start,
    endOffset: detection.end,
    reason,
    candidateSecurityIds: [...new Set(candidates.map((item) => item.security.id))].sort(),
  };
}

function overlaps(left: Detection, right: Detection): boolean {
  return left.start < right.end && right.start < left.end;
}

/** Pure exact-ticker/company-alias resolution. Ambiguity abstains; it is never guessed. */
export function resolveSecurityMentions(
  input: RniSecurityResolutionRequest,
  idFactory: RniMentionIdFactory,
): RniSecurityResolutionResult {
  const parsed = requestSchema.parse(input);
  const ambiguousBare = new Set(parsed.ambiguityPolicy.bareTickerSymbols);
  const detections = parsed.candidates
    .filter((security) => security.active)
    .flatMap((security) => [
      ...tickerDetections(parsed.boundedContent, security),
      ...aliasDetections(parsed.boundedContent, security),
    ]);

  const grouped = new Map<string, Detection[]>();
  for (const detection of detections) {
    const key = detectionKey(detection);
    grouped.set(key, [...(grouped.get(key) ?? []), detection]);
  }

  const unresolvedSpans: RniUnresolvedSecuritySpan[] = [];
  const candidates: Detection[] = [];
  for (const matches of grouped.values()) {
    const first = matches[0];
    if (first === undefined) continue;
    const distinctSecurityIds = new Set(matches.map((match) => match.security.id));
    if (distinctSecurityIds.size > 1) {
      unresolvedSpans.push(unresolved(parsed.boundedContent, first, 'ambiguous_match', matches));
      continue;
    }
    const preferred = matches.find((match) => match.method === 'exact_ticker') ?? first;
    const isBareTicker =
      preferred.method === 'exact_ticker' && parsed.boundedContent[preferred.start] !== '$';
    if (isBareTicker && ambiguousBare.has(preferred.security.symbol.toUpperCase())) {
      unresolvedSpans.push(
        unresolved(parsed.boundedContent, preferred, 'cashtag_required', matches),
      );
      continue;
    }
    candidates.push(preferred);
  }

  // Prefer the longest supported span, then ticker evidence, and never emit overlapping records.
  const selected: Detection[] = [];
  for (const detection of candidates.sort(
    (left, right) =>
      right.end - right.start - (left.end - left.start) ||
      Number(left.method !== 'exact_ticker') - Number(right.method !== 'exact_ticker') ||
      left.start - right.start,
  )) {
    if (!selected.some((current) => overlaps(current, detection))) selected.push(detection);
  }
  selected.sort((left, right) => left.start - right.start || left.end - right.end);

  const occurrences = new Map<string, number>();
  const mentions = selected.map((detection) => {
    const occurrence = occurrences.get(detection.security.id) ?? 0;
    occurrences.set(detection.security.id, occurrence + 1);
    return rniSecurityMention.parse({
      id: idFactory({
        sourceItemId: parsed.sourceItemId,
        securityId: detection.security.id,
        startOffset: detection.start,
        endOffset: detection.end,
        occurrence,
      }),
      sourceItemId: parsed.sourceItemId,
      securityId: detection.security.id,
      mentionText: parsed.boundedContent.slice(detection.start, detection.end),
      startOffset: detection.start,
      endOffset: detection.end,
      resolutionMethod: detection.method,
      resolutionConfidence: '1',
      modelRunId: null,
    });
  });

  return {
    mentions,
    unresolved: unresolvedSpans.sort(
      (left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset,
    ),
  };
}
