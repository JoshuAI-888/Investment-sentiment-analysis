/**
 * F15 — read-side service wrappers. `02-ARCHITECTURE-CONTRACTS.md` §3: `app/` may import
 * `contracts/`, `services/`, `ui/`, `calc/`, `analytics/` — never `repositories/` directly
 * (`architecture/layer-direction`). Every admin page and API route reads through this file
 * rather than reaching into `repositories/*` itself; the functions here are thin — the actual
 * queries stay in `repositories/`, this module only re-exports them at the layer app/ is allowed
 * to depend on.
 */
import {
  findActiveConfigVersion,
  findActiveUniverseVersion,
  listUniverseMembers,
} from '@/repositories/versions';
import { queryUniverseTable, type UniverseTableQuery, type UniverseTableRow } from '@/repositories/universe-table';
import { listAppSettingsForVersion, findActiveAppSetting } from '@/repositories/settings';
import { listModelRoutesForVersion } from '@/repositories/models';
import { listAuditEvents, type AuditEventQuery } from '@/repositories/audit';
import { listCalculationIssues, type CalculationIssueListQuery } from '@/repositories/calculation-issues';
import { spendInWindow } from '@/repositories/cost';
import { costBreakdownInWindow } from '@/repositories/cost-breakdown';
import { searchRawProviderPayloads, countRestrictedPayloads, type DataExplorerQuery } from '@/repositories/data-explorer';
import { insertAuditEvent, type NewAuditEvent } from '@/repositories/audit';
import { readDeploymentPlainValues, readDeploymentSecretStatus } from './secrets';
import { findCatalogueEntry, SETTINGS_CATALOGUE } from './settings-catalogue';
import { ADMIN_ENVIRONMENT } from './constants';

export async function getAdminOverview() {
  const [config, universe, openIssues, recentAudit] = await Promise.all([
    findActiveConfigVersion(ADMIN_ENVIRONMENT),
    findActiveUniverseVersion(ADMIN_ENVIRONMENT),
    listCalculationIssues({ status: 'new', limit: 200 }),
    listAuditEvents({ environment: ADMIN_ENVIRONMENT, limit: 10 }),
  ]);
  return { config, universe, openIssueCount: openIssues.length, recentAudit };
}

export async function getActiveUniverseVersion() {
  return findActiveUniverseVersion(ADMIN_ENVIRONMENT);
}

export async function getUniverseMembers(versionId: string): Promise<string[]> {
  return listUniverseMembers(versionId);
}

export async function getUniverseTable(
  query: UniverseTableQuery,
): Promise<{ readonly rows: UniverseTableRow[]; readonly totalCount: number }> {
  return queryUniverseTable(query);
}

export async function getSettingsCatalogueView() {
  const active = await findActiveConfigVersion(ADMIN_ENVIRONMENT);
  const currentSettings = active === null ? [] : await listAppSettingsForVersion(active.id);
  const byKey = new Map(currentSettings.map((s) => [s.settingKey, s]));

  const catalogue = SETTINGS_CATALOGUE.map((entry) => ({
    key: entry.key,
    label: entry.label,
    description: entry.description,
    valueType: entry.valueType,
    governanceClass: entry.governanceClass,
    value: byKey.get(entry.key)?.value ?? entry.defaultValue,
    isDefault: !byKey.has(entry.key),
  }));

  return { activeConfigVersion: active?.id ?? null, catalogue };
}

export function getDeploymentSettingsView() {
  return {
    secrets: readDeploymentSecretStatus(process.env),
    plain: readDeploymentPlainValues(process.env),
  };
}

export async function getAuditEvents(query: AuditEventQuery) {
  return listAuditEvents(query);
}

export async function getModelRoutesView() {
  const active = await findActiveConfigVersion(ADMIN_ENVIRONMENT);
  const routes = active === null ? [] : await listModelRoutesForVersion(active.id);
  return { activeConfigVersion: active?.id ?? null, routes };
}

export async function getCalculationIssuesView(query: CalculationIssueListQuery) {
  return listCalculationIssues(query);
}

async function budgetThreshold(key: string): Promise<string> {
  const setting = await findActiveAppSetting(ADMIN_ENVIRONMENT, key);
  return (setting?.value as string | undefined) ?? (findCatalogueEntry(key)?.defaultValue as string);
}

export async function getCostLedgerView(from: Date, to: Date) {
  const [totals, breakdown, warnUsd, reduceUsd, hardUsd] = await Promise.all([
    spendInWindow(from, to),
    costBreakdownInWindow(from, to),
    budgetThreshold('budget.warn_usd'),
    budgetThreshold('budget.reduce_usd'),
    budgetThreshold('budget.hard_usd'),
  ]);
  return { totals, breakdown, thresholds: { warnUsd, reduceUsd, hardUsd } };
}

export async function getDataExplorerResults(query: DataExplorerQuery) {
  const [rows, restricted] = await Promise.all([
    searchRawProviderPayloads(query),
    countRestrictedPayloads(query),
  ]);
  return { rows, restricted };
}

/** F15 §4.5: audited on every access, including a zero-row result. */
export async function auditAdminAccess(event: NewAuditEvent): Promise<void> {
  await insertAuditEvent(event);
}
