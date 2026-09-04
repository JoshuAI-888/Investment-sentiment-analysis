/**
 * F17 §4.2 — the public-safe projection of live configuration, model routes and provider policy.
 *
 * **This is an allowlist, not a redaction pass.** Every function below starts from nothing and
 * names, field by field, exactly what is emitted — there is no spot where a whole database row
 * or `AppSetting`/`ModelRoute` object is spread onto the output. A field nobody explicitly
 * listed here cannot leak, structurally, regardless of what gets added to the underlying table
 * later — which is the property `tests/contract/architecture-projection.test.ts` exists to prove
 * by construction rather than by example (§4.2, §6, §7 step 2).
 *
 * **Deliberately not reused: `services/admin/reads.ts`.** That module is F15's admin-only,
 * full-detail read path (secrets status, deployment plain values, the full settings catalogue
 * regardless of governance class, raw audit/cost/universe-table rows). This feature's projection
 * is a different, narrower thing built from its own allowlist, per this feature's own build
 * brief — sharing code with the admin read path would mean a field added there for an admin
 * screen reaches this public page for free, which is exactly what an allowlist is supposed to
 * make impossible.
 *
 * **Never emitted, by construction — nothing below even reads these:** `checksum`, `createdBy`,
 * `approvedBy` off `config_version`; `changeReason`/`selectionQuery`/`impactPreview` off
 * `universe_version`; `maxCostUsd`, `canaryPercent`, `evaluationRunId`, `shadowModel`,
 * `fallbackChain`, `allowedDataClasses`, `calibrationVersion`, `temperature`,
 * `maxInputTokens`/`maxOutputTokens`/`timeoutMs` off `model_route`; any setting key outside
 * `PUBLIC_SAFE_SETTINGS`; anything from `services/admin/secrets.ts` (deployment env values);
 * the admin email allowlist (which is not read from anywhere in this module at all).
 */
import { findActiveConfigVersion, findActiveUniverseVersion } from '@/repositories/versions';
import { listAppSettingsForVersion } from '@/repositories/settings';
import { listModelRoutesForVersion } from '@/repositories/models';
import type { AppSetting, ModelRoute } from '@/contracts/config';
import { getPool, type Queryable } from '@/repositories/client';
import { MODEL_TASKS } from '@/services/llm/ports';
import { ARCHITECTURE_ENVIRONMENT } from './constants';

const MODEL_TASK_SET: ReadonlySet<string> = new Set(MODEL_TASKS);

// ── Settings ───────────────────────────────────────────────────────────────────────────────────

export type PublicSettingEntry = {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly governanceClass: string;
  readonly value: unknown;
};

type SettingAllowlistEntry = {
  readonly key: string;
  readonly label: string;
  readonly description: string;
};

/**
 * The allowlist itself. Every entry is a governance threshold this product's own decision log
 * (D-15, D-32) already documents in plain English — never a secret, a hostname, a connection
 * string, a key prefix, or a quota token. Adding a key here is a deliberate, reviewable act;
 * nothing is admitted by pattern-matching against what F15's catalogue happens to contain.
 *
 * Label/description text is authored fresh here, not imported from
 * `services/admin/settings-catalogue.ts` — see this module's own doc comment for why the two
 * stay independent.
 */
const PUBLIC_SAFE_SETTINGS: readonly SettingAllowlistEntry[] = [
  {
    key: 'trigger.price_move_pct',
    label: 'Price-move trigger threshold',
    description:
      "The daily price move, in percent, on FMP Starter's daily bars that opens an X-sampling window for a name (D-15). This is the trigger — the mechanism that turns 'broad, continuous, free-source watching' into 'X reads spent only when something is actually moving.'",
  },
  {
    key: 'trigger.window_minutes',
    label: 'Trigger window length',
    description: 'How long, in minutes, a name stays eligible for X sampling once its trigger fires.',
  },
  {
    key: 'trigger.x_reads_per_event',
    label: 'X reads per trigger event',
    description: 'The X-read budget spent on one fired trigger.',
  },
  {
    key: 'x.monthly_read_ceiling',
    label: 'X monthly read ceiling',
    description:
      'D-32: starts at zero — X reads are not funded until the price trigger is verified firing on real price movement.',
  },
  {
    key: 'x.daily_read_ceiling',
    label: 'X daily read ceiling',
    description: 'D-32: starts at zero, alongside the monthly ceiling.',
  },
  {
    key: 'budget.warn_usd',
    label: 'Monthly spend — warn threshold',
    description: 'D-20/D-32. The first of three global spend thresholds.',
  },
  {
    key: 'budget.reduce_usd',
    label: 'Monthly spend — reduce-optional threshold',
    description: 'D-20/D-32. The second of three global spend thresholds.',
  },
  {
    key: 'budget.hard_usd',
    label: 'Monthly spend — hard block threshold',
    description: "D-20/D-32. The single global ceiling D-11 leaves as this product's only budget control.",
  },
];

const PUBLIC_SAFE_SETTING_KEYS: ReadonlySet<string> = new Set(
  PUBLIC_SAFE_SETTINGS.map((entry) => entry.key),
);

function projectSetting(entry: SettingAllowlistEntry, row: AppSetting | undefined): PublicSettingEntry {
  return {
    key: entry.key,
    label: entry.label,
    description: entry.description,
    governanceClass: row?.governanceClass ?? 'unset',
    value: row?.value ?? null,
  };
}

/**
 * The pure, DB-free half of the settings projection — every row that could ever exist, no
 * matter what fields it carries or which key it names, is reduced to exactly the allowlisted
 * shape. Exported so `tests/contract/architecture-projection.test.ts` can hand this a
 * deliberately hostile input (a row naming a restricted key, or a row carrying extra fields no
 * allowlist entry named) and assert none of it survives — the allowlist proven by construction,
 * not by trusting the caller passed only safe rows.
 */
export function projectSettings(rows: readonly AppSetting[]): readonly PublicSettingEntry[] {
  const byKey = new Map(rows.map((row) => [row.settingKey, row]));
  return PUBLIC_SAFE_SETTINGS.map((entry) => projectSetting(entry, byKey.get(entry.key)));
}

// ── Model routes ───────────────────────────────────────────────────────────────────────────────

export type PublicModelRoute = {
  readonly task: string;
  readonly transport: string;
  readonly primaryProvider: string;
  readonly primaryModel: string;
  readonly modelRevision: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly enabled: boolean;
};

function projectModelRoute(route: ModelRoute): PublicModelRoute {
  return {
    task: route.task,
    transport: route.transport,
    primaryProvider: route.primaryProvider,
    primaryModel: route.primaryModel,
    modelRevision: route.modelRevision,
    promptVersion: route.promptVersion,
    schemaVersion: route.schemaVersion,
    enabled: route.enabled,
  };
}

/**
 * The pure, DB-free half of the model-route projection. Filtered to the live `MODEL_TASKS`
 * vocabulary (`services/llm/ports.ts`) before projection, not after — a row whose task is not in
 * that vocabulary is dropped rather than shown, so a stray or malformed row never renders as
 * though it named a real task. Exported for the same reason `projectSettings` is.
 */
export function projectModelRoutes(rows: readonly ModelRoute[]): readonly PublicModelRoute[] {
  return rows.filter((route) => MODEL_TASK_SET.has(route.task)).map(projectModelRoute);
}

// ── Config version / universe ─────────────────────────────────────────────────────────────────

export type PublicConfigVersion = {
  readonly id: string;
  readonly status: string;
  readonly effectiveAt: string;
};

export type PublicUniverseVersion = {
  readonly id: string;
  readonly status: string;
  readonly selectedCount: number;
};

// ── The projection ─────────────────────────────────────────────────────────────────────────────

export type ArchitectureProjection = {
  readonly generatedAt: string;
  readonly configVersion: PublicConfigVersion | null;
  readonly universeVersion: PublicUniverseVersion | null;
  readonly settings: readonly PublicSettingEntry[];
  readonly modelRoutes: readonly PublicModelRoute[];
};

/**
 * `null` when no `DATABASE_URL` is configured — the caller renders the same honest "no database
 * configured" state F05's `InspectorPage` already established, never a fabricated projection.
 */
export async function getArchitectureProjection(
  db: Queryable = getPool(),
): Promise<ArchitectureProjection> {
  const configVersion = await findActiveConfigVersion(ARCHITECTURE_ENVIRONMENT, db);

  const [universeVersion, settingRows, modelRouteRows] = await Promise.all([
    findActiveUniverseVersion(ARCHITECTURE_ENVIRONMENT, db),
    configVersion === null
      ? Promise.resolve<AppSetting[]>([])
      : listAppSettingsForVersion(configVersion.id, db),
    configVersion === null
      ? Promise.resolve<ModelRoute[]>([])
      : listModelRoutesForVersion(configVersion.id, db),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    configVersion:
      configVersion === null
        ? null
        : {
            id: configVersion.id,
            status: configVersion.status,
            effectiveAt: configVersion.effectiveAt.toISOString(),
          },
    universeVersion:
      universeVersion === null
        ? null
        : {
            id: universeVersion.id,
            status: universeVersion.status,
            selectedCount: universeVersion.selectedCount,
          },
    settings: projectSettings(settingRows),
    modelRoutes: projectModelRoutes(modelRouteRows),
  };
}

export { PUBLIC_SAFE_SETTINGS, PUBLIC_SAFE_SETTING_KEYS };
