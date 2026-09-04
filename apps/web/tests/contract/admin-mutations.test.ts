/**
 * F15 §5 — "Contract | admin read and mutation schemas." Every mutation's zod schema round-trips
 * a realistic payload, and every read-side contract this feature reuses (`AuditEvent`,
 * `AppSetting`, `ModelRoute`, `UniverseVersion`, `CalculationIssue`) still parses what this
 * feature's repositories hand it — a contract this feature depends on but does not own, so this
 * file exercises the dependency rather than redefining it.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { auditEvent } from '@/contracts/cost';
import { appSetting, modelRoute, universeVersion } from '@/contracts/config';
import { calculationIssue } from '@/contracts/calculation';
import { universeMutationSchema } from '@/services/admin/universe';
import { settingsMutationSchema, rollbackSettingsSchema } from '@/services/admin/settings';
import { resolveIssueSchema } from '@/services/admin/calculation-issues';

describe('F15 mutation schemas round-trip a realistic payload', () => {
  it('universeMutationSchema', () => {
    const parsed = universeMutationSchema.parse({
      reason: 'seed the initial universe',
      expectedVersion: null,
      targetSecurityIds: [randomUUID(), randomUUID()],
      selectionSource: 'seed',
    });
    expect(parsed.targetSecurityIds).toHaveLength(2);
  });

  it('settingsMutationSchema', () => {
    const parsed = settingsMutationSchema.parse({
      reason: 'raise the trigger threshold after a quiet week',
      expectedVersion: '12',
      key: 'trigger.price_move_pct',
      value: '4.00',
    });
    expect(parsed.key).toBe('trigger.price_move_pct');
  });

  it('rollbackSettingsSchema', () => {
    const parsed = rollbackSettingsSchema.parse({
      reason: 'revert a bad threshold change',
      expectedVersion: '13',
      targetVersionId: '11',
    });
    expect(parsed.targetVersionId).toBe('11');
  });

  it('resolveIssueSchema — resolved requires a resolution calculation', () => {
    const id = randomUUID();
    const parsed = resolveIssueSchema.parse({
      reason: 'confirmed a units bug, recomputed',
      expectedVersion: new Date().toISOString(),
      issueId: id,
      status: 'resolved',
      resolutionSummary: 'Fixed a units mismatch and recomputed.',
      resolutionCalculationId: randomUUID(),
    });
    expect(parsed.status).toBe('resolved');
  });

  it('resolveIssueSchema — rejected must not carry a resolution calculation', () => {
    const result = resolveIssueSchema.safeParse({
      reason: 'not actually a bug',
      expectedVersion: null,
      issueId: randomUUID(),
      status: 'rejected',
      resolutionSummary: 'Investigated; working as intended.',
      resolutionCalculationId: randomUUID(),
    });
    expect(result.success).toBe(false);
  });
});

describe('F15 read contracts this feature depends on still parse', () => {
  it('auditEvent', () => {
    expect(() =>
      auditEvent.parse({
        id: randomUUID(),
        occurredAt: new Date(),
        actorId: 'admin-1',
        actorRole: 'admin',
        action: 'universe.activate',
        objectType: 'universe_version',
        objectId: '1',
        environment: 'production',
        reason: 'seed',
        beforeValue: null,
        afterValue: { id: '1' },
        result: 'success',
        requestId: 'req-1',
        correlationId: 'req-1',
        ipHash: null,
        userAgent: null,
        approval: null,
        rollbackOf: null,
      }),
    ).not.toThrow();
  });

  it('appSetting — sensitive must be false (ADR-012)', () => {
    expect(() =>
      appSetting.parse({
        configVersion: '1',
        settingKey: 'trigger.price_move_pct',
        scopeType: 'global',
        scopeId: 'global',
        value: '3.00',
        valueType: 'decimal',
        governanceClass: 'trigger',
        settingSchemaVersion: '1',
        methodAffecting: false,
        sensitive: false,
      }),
    ).not.toThrow();

    expect(() =>
      appSetting.parse({
        configVersion: '1',
        settingKey: 'x',
        scopeType: 'global',
        scopeId: 'global',
        value: 'y',
        valueType: 'string',
        governanceClass: 'trigger',
        settingSchemaVersion: '1',
        methodAffecting: false,
        sensitive: true,
      }),
    ).toThrow();
  });

  it('modelRoute', () => {
    expect(() =>
      modelRoute.parse({
        configVersion: '1',
        task: 'relevance',
        transport: 'vercel_gateway',
        primaryProvider: 'openai',
        primaryModel: 'gpt-x',
        modelRevision: 'rev-1',
        fallbackChain: [],
        promptVersion: '1',
        schemaVersion: '1',
        calibrationVersion: null,
        temperature: '0.0',
        maxInputTokens: 4000,
        maxOutputTokens: 1000,
        timeoutMs: 5000,
        maxCostUsd: '0.01',
        allowedDataClasses: [],
        shadowModel: null,
        canaryPercent: '0',
        evaluationRunId: null,
        enabled: true,
      }),
    ).not.toThrow();
  });

  it('universeVersion — selectedCount is capped at 100 (D-27)', () => {
    expect(() =>
      universeVersion.parse({
        id: '1',
        environment: 'production',
        configVersion: '1',
        status: 'active',
        parentVersion: null,
        selectedCount: 101,
        selectionQuery: null,
        impactPreview: {},
        createdBy: 'admin',
        changeReason: 'seed',
        createdAt: new Date(),
        activatedAt: new Date(),
      }),
    ).toThrow();
  });

  it('calculationIssue', () => {
    expect(() =>
      calculationIssue.parse({
        id: randomUUID(),
        calculationId: randomUUID(),
        inputKey: null,
        stepKey: null,
        reporterUserId: 'admin-1',
        issueType: 'units',
        description: 'looks off',
        status: 'new',
        assignedTo: null,
        adminNotes: null,
        resolutionSummary: null,
        resolutionCalculationId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        resolvedAt: null,
      }),
    ).not.toThrow();
  });
});
