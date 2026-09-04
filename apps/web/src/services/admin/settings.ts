/**
 * F15 §4.2 — the settings mutation. Every config version is a **complete snapshot** of the
 * whole catalogue (mirrors `model_route`/`app_setting`'s own FK shape: both key off
 * `config_version`, not off their own independent version chain), so changing one key means
 * cloning the current active version's full catalogue into a new draft, applying the one
 * override, and activating the draft — never patching a single row of an active version, which
 * would violate `config_version`'s append-only-except-lifecycle trigger (`0009_`) anyway.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { withTransaction, type Queryable } from '@/repositories/client';
import { activateConfigVersion, findActiveConfigVersion, insertConfigVersion } from '@/repositories/versions';
import { findActiveAppSetting, insertAppSetting, listAppSettingsForVersion } from '@/repositories/settings';
import { ADMIN_ENVIRONMENT } from './constants';
import { findCatalogueEntry, SETTING_SCHEMA_VERSION, SETTINGS_CATALOGUE } from './settings-catalogue';
import type { AdminMutationBase, LoadedCurrent, MutationDefinition } from './mutation';

export const settingsMutationSchema = z.object({
  reason: z.string().min(3, 'a change reason is required'),
  expectedVersion: z.string().regex(/^\d+$/).nullable(),
  key: z.string().min(1),
  value: z.unknown(),
});
export type SettingsMutationInput = z.infer<typeof settingsMutationSchema> & AdminMutationBase;

function checksumFor(settings: readonly { readonly settingKey: string; readonly value: unknown }[]): string {
  const canonical = [...settings]
    .sort((a, b) => a.settingKey.localeCompare(b.settingKey))
    .map((s) => `${s.settingKey}=${JSON.stringify(s.value)}`)
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

async function loadCurrentSettings(tx: Queryable): Promise<LoadedCurrent | null> {
  const active = await findActiveConfigVersion(ADMIN_ENVIRONMENT, tx);
  if (active === null) return null;
  return { objectId: active.id, version: active.id, snapshot: active };
}

export const updateSettingMutation: MutationDefinition<SettingsMutationInput> = {
  objectType: 'app_setting',
  action: 'settings.update',
  environment: ADMIN_ENVIRONMENT,
  schema: settingsMutationSchema.superRefine((input, ctx) => {
    const entry = findCatalogueEntry(input.key);
    if (entry === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['key'],
        message: `"${input.key}" is not in the allowlisted settings catalogue (ADR-012, F15 §4.2).`,
      });
      return;
    }
    const result = entry.schema.safeParse(input.value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value', ...issue.path], message: issue.message });
      }
    }
  }),
  loadCurrent: (_input, tx) => loadCurrentSettings(tx),
  impactPreview: async (input, current, tx) => {
    const previous =
      current === null ? null : await findActiveAppSetting(ADMIN_ENVIRONMENT, input.key, tx);
    const entry = findCatalogueEntry(input.key);
    return {
      key: input.key,
      label: entry?.label ?? input.key,
      governanceClass: entry?.governanceClass ?? null,
      previousValue: previous?.value ?? entry?.defaultValue ?? null,
      newValue: input.value,
      methodAffecting: false,
    };
  },
  write: async (input, current, _tx) => {
    // `activateConfigVersion` (below) opens its own transaction and cannot see rows that exist
    // only inside *this* pipeline's outer transaction (`_tx`) until that transaction commits —
    // and it does not commit until this whole `write` returns. So the draft and its settings are
    // written in their **own, separate transaction** (`withTransaction` here, a new connection)
    // that commits before `activateConfigVersion` runs, rather than through `_tx` — which keeps
    // the draft+settings insert atomic as a group while still making it visible to the later,
    // independent activation. Found the hard way: an earlier version of this function passed
    // `_tx` to both inserts and failed every real-Postgres integration run with "config_version
    // N is not a draft or staged version" — the row was there, just invisible to the connection
    // checking for it. See `services/admin/universe.ts`'s module docstring for the parallel case.
    const parentId = current === null ? null : (current.snapshot as { id: string }).id;
    const carriedForward: { settingKey: string; value: unknown }[] = [];

    if (parentId !== null) {
      const rows = await listAppSettingsForVersion(parentId);
      for (const row of rows) carriedForward.push({ settingKey: row.settingKey, value: row.value });
    }
    // Seed defaults for any catalogue key never written before (first-ever settings mutation).
    for (const entry of SETTINGS_CATALOGUE) {
      if (!carriedForward.some((row) => row.settingKey === entry.key)) {
        carriedForward.push({ settingKey: entry.key, value: entry.defaultValue });
      }
    }
    const applied = carriedForward.map((row) =>
      row.settingKey === input.key ? { settingKey: row.settingKey, value: input.value } : row,
    );

    const draft = await withTransaction(async (draftTx) => {
      const inserted = await insertConfigVersion(
        {
          environment: ADMIN_ENVIRONMENT,
          status: 'draft',
          parentVersion: parentId,
          createdBy: 'admin',
          changeReason: input.reason,
          checksum: checksumFor(applied),
        },
        draftTx,
      );
      for (const row of applied) {
        const entry = findCatalogueEntry(row.settingKey);
        await insertAppSetting(
          {
            configVersion: inserted.id,
            settingKey: row.settingKey,
            scopeType: 'global',
            scopeId: 'global',
            value: row.value,
            valueType: entry?.valueType ?? 'string',
            governanceClass: entry?.governanceClass ?? 'trigger',
            settingSchemaVersion: SETTING_SCHEMA_VERSION,
            methodAffecting: false,
          },
          draftTx,
        );
      }
      return inserted;
    });

    const activated = await activateConfigVersion(ADMIN_ENVIRONMENT, draft.id, {
      actorId: 'admin',
      actorRole: 'admin',
      reason: input.reason,
      requestId: 'pipeline',
      correlationId: 'pipeline',
    });

    return { objectId: activated.id, afterValue: { configVersion: activated, settings: applied }, rollbackTarget: parentId };
  },
};

// ── Rollback (F15 §4.4) ────────────────────────────────────────────────────────────────────────
// "Rollback activates a prior version as a new version — history is never rewound." A full
// snapshot restore, not a single-key edit: the target version's entire settings catalogue
// becomes the new active version's content, whatever the current active version had drifted to.

export const rollbackSettingsSchema = z.object({
  reason: z.string().min(3, 'a change reason is required'),
  expectedVersion: z.string().regex(/^\d+$/).nullable(),
  targetVersionId: z.string().regex(/^\d+$/),
});
export type RollbackSettingsInput = z.infer<typeof rollbackSettingsSchema> & AdminMutationBase;

export const rollbackSettingsMutation: MutationDefinition<RollbackSettingsInput> = {
  objectType: 'app_setting',
  action: 'settings.rollback',
  environment: ADMIN_ENVIRONMENT,
  schema: rollbackSettingsSchema,
  loadCurrent: (_input, tx) => loadCurrentSettings(tx),
  impactPreview: async (input, _current, tx) => {
    const targetSettings = await listAppSettingsForVersion(input.targetVersionId, tx);
    if (targetSettings.length === 0) {
      throw new Error(`config_version ${input.targetVersionId} carries no settings to roll back to.`);
    }
    return {
      targetVersionId: input.targetVersionId,
      restoredKeyCount: targetSettings.length,
      restoredKeys: targetSettings.map((s) => s.settingKey),
    };
  },
  write: async (input, current, _tx) => {
    // See `updateSettingMutation.write`'s comment: the draft and its settings must commit, as a
    // group, in their own transaction before `activateConfigVersion`'s own, separate transaction
    // can see them — passing `_tx` here reproduces the "not a draft or staged version" failure.
    const targetSettings = await listAppSettingsForVersion(input.targetVersionId);
    const parentId = current === null ? null : (current.snapshot as { id: string }).id;

    const draft = await withTransaction(async (draftTx) => {
      const inserted = await insertConfigVersion(
        {
          environment: ADMIN_ENVIRONMENT,
          status: 'draft',
          parentVersion: parentId,
          createdBy: 'admin',
          changeReason: `Rollback to config_version ${input.targetVersionId}: ${input.reason}`,
          checksum: checksumFor(targetSettings.map((s) => ({ settingKey: s.settingKey, value: s.value }))),
        },
        draftTx,
      );
      for (const row of targetSettings) {
        await insertAppSetting(
          {
            configVersion: inserted.id,
            settingKey: row.settingKey,
            scopeType: row.scopeType,
            scopeId: row.scopeId,
            value: row.value,
            valueType: row.valueType,
            governanceClass: row.governanceClass,
            settingSchemaVersion: row.settingSchemaVersion,
            methodAffecting: row.methodAffecting,
          },
          draftTx,
        );
      }
      return inserted;
    });

    const activated = await activateConfigVersion(ADMIN_ENVIRONMENT, draft.id, {
      actorId: 'admin',
      actorRole: 'admin',
      reason: input.reason,
      requestId: 'pipeline',
      correlationId: 'pipeline',
    });

    return {
      objectId: activated.id,
      afterValue: { configVersion: activated, restoredFrom: input.targetVersionId },
      rollbackTarget: parentId,
    };
  },
};
