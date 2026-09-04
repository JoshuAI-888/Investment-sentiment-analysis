import rule from '../../../eslint-rules/no-sql-outside-repositories';
import { asEslintRule, ruleTester } from './rule-tester';

ruleTester.run('no-sql-outside-repositories', asEslintRule(rule), {
  valid: [
    {
      name: 'a repository is where SQL belongs',
      filename: 'src/repositories/security.ts',
      code: `export const q = 'select id from security where symbol = $1';`,
    },
    {
      name: 'a service calling a repository',
      filename: 'src/services/dashboard.ts',
      code: `import { findSecurityById } from '@/repositories/security';\nexport const get = (id: string) => findSecurityById(id);`,
    },
    {
      name: 'prose that merely contains the word select',
      filename: 'src/services/dashboard.ts',
      code: `export const label = 'Select a ticker from the list';`,
    },
    {
      name: 'a template literal with no SQL',
      filename: 'src/ui/Table.tsx',
      code: 'export const title = `Rows updated`;',
    },
    {
      name: 'prose whose verb and preposition both appear in SQL',
      // The case that caught the first version of this rule. "from the" is prose; "from
      // security" is a query, and the determiner is what tells them apart.
      filename: 'src/ui/Empty.tsx',
      code: `export const hint = 'Choose from these options to select a sector';`,
    },
    {
      name: 'a word that merely starts with a SQL verb',
      filename: 'src/services/dashboard.ts',
      code: `export const label = 'Updated from the latest snapshot';`,
    },
  ],
  invalid: [
    {
      name: 'a select in a service',
      filename: 'src/services/dashboard.ts',
      code: `export const q = 'select price from market_snapshot where security_id = $1';`,
      errors: [{ messageId: 'sqlOutsideRepositories' }],
    },
    {
      name: 'an insert in a route handler',
      filename: 'app/api/admin/data/route.ts',
      code: `const q = 'insert into audit_event (actor_id) values ($1)';`,
      errors: [{ messageId: 'sqlOutsideRepositories' }],
    },
    {
      name: 'a template-literal query in an adapter',
      filename: 'src/adapters/fmp.ts',
      code: 'const q = `select * from security where active = true`;',
      errors: [{ messageId: 'sqlOutsideRepositories' }],
    },
    {
      name: 'a delete in a ui component',
      filename: 'src/ui/Table.tsx',
      code: `const q = 'delete from evidence_item where id = $1';`,
      errors: [{ messageId: 'sqlOutsideRepositories' }],
    },
    {
      name: 'DDL in analytics',
      filename: 'src/analytics/attention.ts',
      code: `const q = 'create index foo on bar (baz)';`,
      errors: [{ messageId: 'sqlOutsideRepositories' }],
    },
  ],
});
