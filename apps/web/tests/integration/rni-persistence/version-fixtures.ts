import type pg from 'pg';

export async function seedRniVersionLineage(
  pool: pg.Pool,
  label: string,
): Promise<{ readonly configVersion: string; readonly universeVersion: string }> {
  const { rows: configRows } = await pool.query<{ id: string }>(
    `insert into config_version (
       environment, status, created_by, change_reason, checksum
     ) values ('test', 'draft', 'rni-data-test', $1, $2)
     returning id`,
    [`${label} config`, `${label}-config-checksum`],
  );
  const configVersion = configRows[0]!.id;
  const { rows: universeRows } = await pool.query<{ id: string }>(
    `insert into universe_version (
       environment, config_version, status, selected_count, created_by, change_reason
     ) values ('test', $1, 'draft', 0, 'rni-data-test', $2)
     returning id`,
    [configVersion, `${label} universe`],
  );
  return { configVersion, universeVersion: universeRows[0]!.id };
}
