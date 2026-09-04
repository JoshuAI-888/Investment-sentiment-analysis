import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { providerId } from '@/contracts/provider';
import { MODEL_TASKS } from '@/services/llm/ports';
import { methods as REGISTRY_METHODS } from '@/analytics/registry';
import { METHOD_REGISTRY } from '@/services/calculations';
import {
  JOBS,
  KNOWN_UNWIRED_PROVIDERS,
  MODEL_TASK_TOPOLOGY,
  WIRED_PROVIDERS,
} from '@/services/architecture/manifest';
import {
  reconcileJobs,
  reconcileMethods,
  reconcileModelTasks,
  reconcileProviders,
} from '@/services/architecture/reconciliation';
import { walk, readFiles, WEB_ROOT } from '../../../../scripts/checks/load';

/**
 * F17 §5/§6 — "CI manifest reconciliation... fails on drift in either direction." Every provider,
 * job, model route and method the manifest names is checked against the live source, scanned
 * fresh on every run — never against a snapshot.
 */

const PROVIDER_LITERAL = /(?:provider\s*:\s*|_PROVIDER\s*=\s*)['"]([a-z_]+)['"]/g;
const JOB_KEY_LITERAL = /_JOB_KEY\s*=\s*['"]([a-z_]+)['"]/g;

/**
 * `*.test.ts`, and every `testing.ts` file under a `services` subdirectory (e.g.
 * `services/ticker/testing.ts`'s seeded fixture rows, which include a `provider: 'reddit'` row
 * — the ticker page once rendered a live Reddit axis, and the fixture was never pruned after
 * D-39 retired the collector), are test-fixture-seeding helpers, not production adapter or
 * collector code — a literal inside one says nothing about what is actually wired.
 */
function isTestFixtureFile(filePath: string): boolean {
  return filePath.includes('.test.ts') || /(?:^|\/)testing\.ts$/.test(filePath);
}

async function scanWiredProviders(): Promise<string[]> {
  const files = await readFiles([
    ...(await walk(path.join(WEB_ROOT, 'src/adapters'), ['.ts'])),
    ...(await walk(path.join(WEB_ROOT, 'src/services'), ['.ts'])),
  ]);
  const found = new Set<string>();
  const contractIds = new Set<string>(providerId.options);
  for (const file of files) {
    if (isTestFixtureFile(file.path)) continue;
    for (const match of file.content.matchAll(PROVIDER_LITERAL)) {
      const id = match[1];
      // Only a literal that is actually a live provider id counts — this scan also matches
      // incidental `_PROVIDER = '...'` constants elsewhere in the tree that name something else.
      if (id !== undefined && contractIds.has(id)) found.add(id);
    }
  }
  return [...found];
}

async function scanJobKeys(): Promise<string[]> {
  const files = await readFiles(await walk(path.join(WEB_ROOT, 'src/services/jobs'), ['.ts']));
  const found = new Set<string>();
  for (const file of files) {
    if (isTestFixtureFile(file.path)) continue;
    for (const match of file.content.matchAll(JOB_KEY_LITERAL)) {
      const key = match[1];
      if (key !== undefined) found.add(key);
    }
  }
  return [...found];
}

describe('architecture manifest reconciliation — providers', () => {
  it('every live-wired provider (grepped from src/adapters and src/services) matches the manifest exactly', async () => {
    const scanned = await scanWiredProviders();
    const findings = reconcileProviders({
      contractProviderIds: [...providerId.options],
      manifestWired: [...WIRED_PROVIDERS],
      manifestUnwired: KNOWN_UNWIRED_PROVIDERS.map((entry) => entry.provider),
      scannedWiredProviders: scanned,
    });
    expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
  });

  it('reddit is the one disclosed gap (D-39) — confirmed against the live contract enum', () => {
    expect(KNOWN_UNWIRED_PROVIDERS.map((entry) => entry.provider)).toEqual(['reddit']);
  });

  it('fails when the manifest widens the wired set without cause (adversarial: adding a restricted, unwired provider as "wired")', () => {
    const findings = reconcileProviders({
      contractProviderIds: [...providerId.options],
      manifestWired: [...WIRED_PROVIDERS, 'reddit'],
      manifestUnwired: [],
      scannedWiredProviders: [...WIRED_PROVIDERS],
    });
    expect(findings.some((f) => f.category === 'provider' && f.id === 'reddit')).toBe(true);
  });
});

describe('architecture manifest reconciliation — jobs', () => {
  it('every exported *_JOB_KEY constant under src/services/jobs matches the manifest exactly', async () => {
    const scanned = await scanJobKeys();
    const findings = reconcileJobs({
      manifestJobKeys: JOBS.map((job) => job.jobKey),
      scannedJobKeys: scanned,
    });
    expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
  });

  it('fails when a live job key is renamed out from under the manifest (adversarial)', () => {
    const findings = reconcileJobs({
      manifestJobKeys: JOBS.map((job) => job.jobKey),
      scannedJobKeys: ['market_data_poll', 'attention_poll'], // x_sampling_window renamed/removed
    });
    expect(findings.some((f) => f.id === 'x_sampling_window')).toBe(true);
  });
});

describe('architecture manifest reconciliation — model tasks', () => {
  it('every live MODEL_TASKS entry (services/llm/ports.ts) matches the manifest exactly', () => {
    const findings = reconcileModelTasks({
      manifestModelTasks: MODEL_TASK_TOPOLOGY.map((task) => task.task),
      liveModelTasks: [...MODEL_TASKS],
    });
    expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
  });
});

describe('architecture manifest reconciliation — methods', () => {
  it('the registry (analytics/registry.ts) and the bound METHOD_REGISTRY name exactly the same id@version set', () => {
    const registryIds = REGISTRY_METHODS.map((m) => `${m.id}@${m.version}`);
    const boundIds = METHOD_REGISTRY.all().map((entry) => `${entry.id}@${entry.version}`);
    const findings = reconcileMethods({ registryIds, boundIds });
    expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
  });

  it('fails on a method removed from one side but not the other (adversarial)', () => {
    const findings = reconcileMethods({
      registryIds: ['a.b@1.0.0', 'c.d@1.0.0'],
      boundIds: ['a.b@1.0.0'],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe('c.d@1.0.0');
  });
});
