import { describe, expect, it } from 'vitest';

import {
  RNI_PROMPT_HISTORY,
  RNI_PROMPT_INPUT_SCHEMAS,
  RNI_PROMPT_REGISTRY,
  type RniPromptTask,
} from '../../../../prompts/rni/registry';
import {
  compileRniInputSchemaAuthority,
  withRniInputSchemaRefinements,
} from '@/rni/agents/input-schema-authority';
import { hashRniWorkerSnapshotValue } from '@/rni/orchestration/worker-manifest';

const tasks = [
  'rni_discovery',
  'rni_relationship',
  'rni_classifier',
  'rni_verification',
  'rni_challenger',
] as const satisfies readonly RniPromptTask[];

const driftField = {
  rni_discovery: 'queryId',
  rni_relationship: 'sourceItemId',
  rni_classifier: 'sourceItemId',
  rni_verification: 'runId',
  rni_challenger: 'runId',
} as const;

describe('RNI prompt input-schema authority', () => {
  it.each(tasks)('binds the %s parser and fingerprint to one actual Zod schema', (task) => {
    const definition = RNI_PROMPT_REGISTRY[task];
    const schema =
      RNI_PROMPT_INPUT_SCHEMAS[
        definition.inputSchemaVersion as keyof typeof RNI_PROMPT_INPUT_SCHEMAS
      ];
    const compiled = compileRniInputSchemaAuthority(schema);

    expect(compiled).toEqual(definition.inputSchemaAuthority);
    expect(JSON.stringify(compiled)).toContain('stable_refinement_rules');
    const compiledHash = hashRniWorkerSnapshotValue({ schema: compiled });
    expect(
      hashRniWorkerSnapshotValue({
        schema: compileRniInputSchemaAuthority(schema.optional()),
      }),
    ).not.toBe(compiledHash);

    const driftedSchema = withRniInputSchemaRefinements(schema, [
      {
        kind: 'forbid_string_pattern',
        field: driftField[task],
        pattern: '^00000000-0000-4000-8000-000000000000$',
        flags: 'u',
        issuePath: [driftField[task]],
        message: 'Schema drift probe',
      },
    ] as const);
    expect(
      hashRniWorkerSnapshotValue({ schema: compileRniInputSchemaAuthority(driftedSchema) }),
    ).not.toBe(compiledHash);
  });

  it('gives one shared schema version one exact parser authority across prompt history', () => {
    const byVersion = new Map<string, string>();
    for (const definition of RNI_PROMPT_HISTORY) {
      const hash = hashRniWorkerSnapshotValue({ schema: definition.inputSchemaAuthority });
      expect(byVersion.get(definition.inputSchemaVersion) ?? hash).toBe(hash);
      byVersion.set(definition.inputSchemaVersion, hash);
    }
  });
});
