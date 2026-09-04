import { describe, expect, it, vi } from 'vitest';

import * as agents from '../../../src/rni/agents';
import { rniCombinedSummary } from '../../../src/rni/contracts';
import {
  evidenceReader,
  NO_MATERIAL_CHALLENGE,
  SUPPORTED_ASSESSMENTS,
  synthesisRequest,
} from '../../unit/rni/agents/fixtures';

function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) allKeys(entry, keys);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      keys.add(key);
      allKeys(entry, keys);
    }
  }
  return keys;
}

describe('RNI cited synthesis contract', () => {
  it('exposes only injected synthesis/replay and its internal types/version', () => {
    expect(Object.keys(agents).sort()).toEqual([
      'RNI_CITED_SYNTHESIS_CODE_VERSION',
      'createRniCitedSynthesisInferencePorts',
      'createRniModelRouter',
      'replayCitedSynthesis',
      'synthesizeCitedNarrative',
    ]);
  });

  it('returns the frozen three-section summary and preserves exact E07 component conclusions', async () => {
    const request = synthesisRequest();
    const artifact = await agents.synthesizeCitedNarrative(
      request,
      evidenceReader(),
      { verify: vi.fn(async () => ({ assessments: SUPPORTED_ASSESSMENTS })) },
      { challenge: vi.fn(async () => NO_MATERIAL_CHALLENGE) },
    );

    expect(rniCombinedSummary.parse(artifact.result.summary)).toEqual(artifact.result.summary);
    expect(artifact.result.summary.sections.map(({ heading }) => heading)).toEqual([
      'Reddit sentiment',
      'X sentiment',
      'Combined summary',
    ]);
    expect(artifact.result.platformConclusions).toEqual(request.convergenceArtifact.result.platforms);
  });

  it('makes every evidentiary sentence traceable and exposes no pooled or model-authored metric', async () => {
    const artifact = await agents.synthesizeCitedNarrative(
      synthesisRequest(),
      evidenceReader(),
      { verify: vi.fn(async () => ({ assessments: SUPPORTED_ASSESSMENTS })) },
      { challenge: vi.fn(async () => NO_MATERIAL_CHALLENGE) },
    );
    for (const section of artifact.result.summary.sections) {
      const statements = artifact.result.statements.filter(
        ({ heading }) => heading === section.heading,
      );
      expect(section.text).toBe(statements.map(({ text }) => text).join(' '));
      expect(section.citationIds).toEqual(
        [...new Set(statements.flatMap(({ citationIds }) => citationIds))].sort(),
      );
    }
    for (const statement of artifact.result.statements) {
      if (statement.origin !== 'coverage_disclosure') {
        expect(statement.citationIds.length).toBeGreaterThan(0);
      }
    }
    const keys = allKeys(artifact.result);
    for (const forbidden of [
      'combinedSentiment',
      'combinedAttention',
      'combinedSourceCount',
      'pooledMetric',
      'modelText',
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect(artifact.modelInputSnapshot.policy).toMatchObject({
      sourceContentTreatment: 'untrusted_data',
      allowedTools: [],
      outputTextPublication: 'forbidden_structured_verdicts_only',
    });
  });
});
