import { z } from 'zod';
import { getPool, type Queryable } from '../../../repositories/client';
import { rniRadarSecurity, type RniRadarSecurity } from '../../contracts';
import { RniReadError } from '../errors';

const ticker = z.string().regex(/^[A-Z][A-Z0-9.-]{0,9}$/u);
const uuid = z.string().uuid();

/** Select the newest immutable run only inside the trusted deployment environment. */
export async function findLatestRniRunId(
  environment: string,
  db: Queryable = getPool(),
): Promise<string | null> {
  const parsedEnvironment = z.string().min(1).parse(environment);
  const { rows } = await db.query<{ id: string }>(
    `select r.id
       from rni_run r
       join config_version c on c.id = r.config_version
       join universe_version u on u.id = r.universe_version
      where c.environment = $1 and u.environment = $1
      order by r.requested_at desc, r.id desc
      limit 1`,
    [parsedEnvironment],
  );
  return rows[0]?.id ?? null;
}

/**
 * Select the newest result-visible run. Operational status deliberately continues to use
 * findLatestRniRunId so an in-progress v2 full-universe run remains observable while its staged
 * members stay hidden until the exact aggregate release exists.
 */
export async function findLatestVisibleRniRunId(
  environment: string,
  db: Queryable = getPool(),
): Promise<string | null> {
  const parsedEnvironment = z.string().min(1).parse(environment);
  const { rows } = await db.query<{ id: string }>(
    `select run.id
       from rni_run run
       join config_version config on config.id = run.config_version
       join universe_version universe on universe.id = run.universe_version
       join rni_run_execution_scope scope on scope.run_id = run.id
       left join rni_orchestration_execution execution on execution.run_id = run.id
      where config.environment = $1 and universe.environment = $1
        and (
          scope.scope_kind = 'manual_ticker'
          or execution.run_id is null
          or execution.record ->> 'version' = 'rni-execution-v1'
          or (
            scope.scope_kind = 'full_universe'
            and execution.record ->> 'version' = 'rni-execution-v2'
            and exists (
              select 1
                from rni_worker_run_manifest manifest
                join rni_full_universe_publication_release release
                  on release.run_id = manifest.run_id
                 and release.plan_hash = manifest.plan_hash
                 and release.run_manifest_hash = manifest.run_manifest_hash
                 and release.universe_version = manifest.universe_version
                 and release.member_set_hash = manifest.member_set_hash
                 and release.expected_member_count = manifest.member_count
               where manifest.run_id = run.id
                 and manifest.scope_kind = 'full_universe'
                 and manifest.plan_hash = execution.plan_hash
                 and manifest.run_manifest_hash = execution.record ->> 'runManifestHash'
                 and manifest.universe_version = run.universe_version
            )
          )
        )
      order by run.requested_at desc, run.id desc
      limit 1`,
    [parsedEnvironment],
  );
  return rows[0]?.id ?? null;
}

/** Resolve a ticker only when it belongs to the run's frozen universe and execution scope. */
export async function findRunSecurityByTicker(
  runId: string,
  requestedTicker: string,
  environment: string,
  db: Queryable = getPool(),
): Promise<RniRadarSecurity | null> {
  if (!uuid.safeParse(runId).success || !ticker.safeParse(requestedTicker).success) {
    throw new RniReadError('INVALID_REQUEST');
  }
  const parsedEnvironment = z.string().min(1).parse(environment);
  const { rows } = await db.query(
    `select s.id, s.symbol as ticker, s.name as "companyName", s.exchange
       from rni_run r
       join config_version c on c.id = r.config_version
       join universe_version u on u.id = r.universe_version
       join rni_run_execution_scope scope on scope.run_id = r.id
       join universe_member member on member.universe_version = r.universe_version
         and member.enabled
       join security s on s.id = member.security_id
      where r.id = $1 and c.environment = $2 and u.environment = $2
        and s.symbol = $3
        and (scope.scope_kind = 'full_universe' or scope.security_id = s.id)
      limit 2`,
    [runId, parsedEnvironment, requestedTicker],
  );
  if (rows.length > 1) throw new RniReadError('CONFLICT');
  return rows[0] ? rniRadarSecurity.parse(rows[0]) : null;
}

/** Return the newest staged universe in this deployment, if one awaits review. */
export async function findLatestStagedUniverseId(
  environment: string,
  db: Queryable = getPool(),
): Promise<string | null> {
  const parsedEnvironment = z.string().min(1).parse(environment);
  const { rows } = await db.query<{ id: string }>(
    `select id::text as id
       from universe_version
      where environment = $1 and status = 'staged'
      order by created_at desc, id desc
      limit 1`,
    [parsedEnvironment],
  );
  return rows[0]?.id ?? null;
}
