import rule from '../../../eslint-rules/no-unbounded-pit-read';
import { BITEMPORAL_TABLES } from '../../../src/contracts/bitemporal';
import { asEslintRule, ruleTester } from './rule-tester';

/**
 * F01 shipped this as a stub passing on empty — there were no bitemporal tables until F22.
 * **F22 arms it**, which is F22's own DoD item and not a follow-up: until the table set is
 * real, the rule gates nothing.
 *
 * The options below are the SAME list `eslint.config.ts` uses, imported rather than retyped. A
 * rule proven against a different set from the one it runs with has been proven to work
 * somewhere it does not run.
 */
const withTables = [{ bitemporalTables: [...BITEMPORAL_TABLES] }];

ruleTester.run('no-unbounded-pit-read', asEslintRule(rule), {
  valid: [
    {
      name: 'passes on empty — the F01 stub configuration',
      filename: 'src/repositories/snapshots.ts',
      code: `export async function all(db: Db) { return db.query('select * from market_snapshot'); }`,
    },
    {
      name: 'a read bounded by asOf',
      filename: 'src/repositories/snapshots.ts',
      options: withTables,
      code: `export async function read(db: Db, asOf: string) {
  return db.query('select * from market_snapshot where ingested_at <= $1', [asOf]);
}`,
    },
    {
      name: 'a template literal bounded by asOf',
      filename: 'src/repositories/snapshots.ts',
      options: withTables,
      code: `export async function read(db: Db, asOf: string) {
  return db.query(\`select * from attention_snapshot where ingested_at <= \${asOf}\`);
}`,
    },
    {
      name: 'a table that is not bitemporal',
      filename: 'src/repositories/jobs.ts',
      options: withTables,
      code: `export async function all(db: Db) { return db.query('select * from job_definition'); }`,
    },
    {
      name: 'the same query outside repositories/ is not this rule’s business',
      filename: 'src/services/dashboard.ts',
      options: withTables,
      code: `export async function all(db: Db) { return db.query('select * from market_snapshot'); }`,
    },
    {
      name: 'an INSERT ... RETURNING names the table but is not a read',
      // Caught in the real tree the moment the rule was armed. It reads back the row it just
      // wrote — trivially point-in-time correct — and reporting it is the cry-wolf failure
      // that gets a rule switched off on its second PR.
      filename: 'src/repositories/security.ts',
      options: withTables,
      code: `export async function add(db: Db) {
  return db.query('insert into security_profile_snapshot (a) values ($1) returning *', [1]);
}`,
    },
    {
      name: 'a DELETE is retention’s business, not this rule’s',
      filename: 'src/repositories/retention.ts',
      options: withTables,
      code: `export async function purge(db: Db) { return db.query('delete from evidence_item where id = $1', [1]); }`,
    },
  ],
  invalid: [
    // Every table in the live set, so arming the rule with a list the guard does not actually
    // cover shows up here rather than in production.
    ...BITEMPORAL_TABLES.map((table) => ({
      name: `an unbounded read of ${table}`,
      filename: 'src/repositories/snapshots.ts',
      options: withTables,
      code: `export async function all(db: Db) { return db.query('select * from ${table}'); }`,
      errors: [{ messageId: 'unboundedRead' as const }],
    })),
    {
      name: 'an asOf parameter that the body never applies is not a bound',
      filename: 'src/repositories/snapshots.ts',
      options: withTables,
      code: `export async function read(db: Db, asOf: string) {
  return db.query('select * from market_snapshot');
}`,
      errors: [{ messageId: 'unboundedRead' }],
    },
    {
      name: 'an unbounded template literal',
      filename: 'src/repositories/snapshots.ts',
      options: withTables,
      code: `export async function all(db: Db) {
  return db.query(\`select * from attention_snapshot order by observed_at desc\`);
}`,
      errors: [{ messageId: 'unboundedRead' }],
    },
    {
      name: 'a join reaches a bitemporal table just as thoroughly as a from',
      filename: 'src/repositories/snapshots.ts',
      options: withTables,
      code: `export async function all(db: Db) {
  return db.query('select s.id from security s join evidence_item e on e.security_id = s.id');
}`,
      errors: [{ messageId: 'unboundedRead' }],
    },
  ],
});
