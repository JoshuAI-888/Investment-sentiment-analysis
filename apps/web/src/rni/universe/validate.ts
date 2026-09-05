import {
  RNI_UNIVERSE_MAX_SYMBOLS,
  rniUniverseSnapshotCandidate,
  type RniUniverseSnapshotCandidate,
} from '../contracts';
import type { FmpSp500Constituent } from '../../adapters/fmp-universe';

export const RNI_SP500_MIN_MEMBERS = 501;

export type UniverseSecurity = {
  readonly id: string;
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string;
  readonly active: boolean;
};

export type ResolvedFmpUniverseMember = {
  readonly securityId: string;
  readonly providerSymbol: string;
  readonly providerCompanyName: string;
  readonly constituentFirstAddedAt: string | null;
};

export type FmpUniverseValidationIssue =
  | { readonly code: 'partial_payload'; readonly count: number }
  | { readonly code: 'over_ceiling'; readonly count: number }
  | { readonly code: 'duplicate_symbol'; readonly symbols: readonly string[] }
  | { readonly code: 'missing_nvda' }
  | { readonly code: 'invalid_first_added_at'; readonly symbols: readonly string[] }
  | { readonly code: 'unresolved_symbol'; readonly symbols: readonly string[] }
  | { readonly code: 'ambiguous_symbol'; readonly symbols: readonly string[] };

export type FmpUniverseValidation =
  | {
      readonly ok: true;
      readonly snapshot: RniUniverseSnapshotCandidate;
      readonly members: readonly ResolvedFmpUniverseMember[];
    }
  | { readonly ok: false; readonly issues: readonly FmpUniverseValidationIssue[] };

function symbolKey(value: string): string {
  return value.trim().toUpperCase();
}

function companyKey(value: string): string {
  return value
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, '');
}

function firstAddedAt(value: string | null | undefined):
  | { readonly valid: true; readonly value: string | null }
  | { readonly valid: false } {
  if (value === undefined || value === null) return { valid: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return { valid: false };
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return { valid: false };
  }
  return { valid: true, value: parsed.toISOString() };
}

export function validateAndResolveFmpUniverse(input: {
  readonly constituents: readonly FmpSp500Constituent[];
  readonly securities: readonly UniverseSecurity[];
  readonly retrievedAt: string;
  readonly payloadSha256: string;
}): FmpUniverseValidation {
  const issues: FmpUniverseValidationIssue[] = [];
  const constituentCount = input.constituents.length;
  if (constituentCount < RNI_SP500_MIN_MEMBERS) {
    issues.push({ code: 'partial_payload', count: constituentCount });
  }
  if (constituentCount > RNI_UNIVERSE_MAX_SYMBOLS) {
    issues.push({ code: 'over_ceiling', count: constituentCount });
  }

  const constituentSymbols = input.constituents.map((member) => symbolKey(member.symbol));
  const duplicates = [...new Set(constituentSymbols.filter((symbol, index) =>
    constituentSymbols.indexOf(symbol) !== index,
  ))].sort();
  if (duplicates.length > 0) issues.push({ code: 'duplicate_symbol', symbols: duplicates });
  if (!constituentSymbols.includes('NVDA')) issues.push({ code: 'missing_nvda' });

  const securitiesBySymbol = new Map<string, UniverseSecurity[]>();
  for (const security of input.securities) {
    if (!security.active) continue;
    const key = symbolKey(security.symbol);
    securitiesBySymbol.set(key, [...(securitiesBySymbol.get(key) ?? []), security]);
  }

  const unresolved: string[] = [];
  const ambiguous: string[] = [];
  const invalidFirstAddedAt: string[] = [];
  const resolved: ResolvedFmpUniverseMember[] = [];
  const candidates: RniUniverseSnapshotCandidate['members'] = [];

  for (const constituent of input.constituents) {
    const key = symbolKey(constituent.symbol);
    const symbolMatches = securitiesBySymbol.get(key) ?? [];
    const exactCompanyMatches = symbolMatches.filter(
      (security) => companyKey(security.name) === companyKey(constituent.name),
    );
    const matches = exactCompanyMatches.length === 1 ? exactCompanyMatches : symbolMatches;
    if (matches.length === 0) {
      unresolved.push(key);
      continue;
    }
    if (matches.length !== 1) {
      ambiguous.push(key);
      continue;
    }
    const security = matches[0];
    if (security === undefined) continue;
    const constituentFirstAddedAt = firstAddedAt(constituent.dateFirstAdded);
    if (!constituentFirstAddedAt.valid) invalidFirstAddedAt.push(key);
    candidates.push({
      ticker: symbolKey(security.symbol),
      companyName: security.name,
      exchange: security.exchange,
      fmpSymbol: constituent.symbol,
    });
    resolved.push({
      securityId: security.id,
      providerSymbol: constituent.symbol,
      providerCompanyName: constituent.name,
      constituentFirstAddedAt: constituentFirstAddedAt.valid
        ? constituentFirstAddedAt.value
        : null,
    });
  }

  if (unresolved.length > 0) {
    issues.push({ code: 'unresolved_symbol', symbols: [...new Set(unresolved)].sort() });
  }
  if (ambiguous.length > 0) {
    issues.push({ code: 'ambiguous_symbol', symbols: [...new Set(ambiguous)].sort() });
  }
  if (invalidFirstAddedAt.length > 0) {
    issues.push({
      code: 'invalid_first_added_at',
      symbols: [...new Set(invalidFirstAddedAt)].sort(),
    });
  }
  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    snapshot: rniUniverseSnapshotCandidate.parse({
      source: 'fmp_sp500_constituent',
      retrievedAt: input.retrievedAt,
      payloadSha256: input.payloadSha256,
      members: candidates,
    }),
    members: resolved,
  };
}
