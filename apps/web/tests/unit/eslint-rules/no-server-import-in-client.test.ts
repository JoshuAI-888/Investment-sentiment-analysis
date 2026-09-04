import rule from '../../../eslint-rules/no-server-import-in-client';
import { asEslintRule, ruleTester } from './rule-tester';

ruleTester.run('no-server-import-in-client', asEslintRule(rule), {
  valid: [
    {
      name: 'a server component may import env.ts',
      filename: 'app/(app)/dashboard/page.tsx',
      code: `import { env } from '@/env';`,
    },
    {
      name: 'a server component may import a repository',
      filename: 'src/services/dashboard.ts',
      code: `import { findSnapshot } from '@/repositories/snapshots';`,
    },
    {
      name: 'a client component importing a contract',
      filename: 'src/ui/Badge.tsx',
      code: `'use client';\nimport type { Freshness } from '@/contracts/freshness';`,
    },
    {
      name: 'a directive that is not at the top of the file is not a directive',
      filename: 'src/ui/Badge.tsx',
      code: `const x = 1;\n'use client';\nimport { env } from '@/env';`,
    },
  ],
  invalid: [
    {
      name: "env.ts from a 'use client' module",
      filename: 'src/ui/Badge.tsx',
      code: `'use client';\nimport { env } from '@/env';`,
      errors: [{ messageId: 'serverOnly' }],
    },
    {
      name: 'a repository from a client component',
      filename: 'src/ui/Table.tsx',
      code: `'use client';\nimport { findSnapshot } from '@/repositories/snapshots';`,
      errors: [{ messageId: 'serverOnly' }],
    },
    {
      name: 'an adapter from a client component',
      filename: 'app/(app)/dashboard/Chart.tsx',
      code: `'use client';\nimport { fetchQuote } from '@/adapters/fmp';`,
      errors: [{ messageId: 'serverOnly' }],
    },
    {
      name: 'a relative path to env.ts',
      filename: 'src/ui/Badge.tsx',
      code: `'use client';\nimport { env } from '../env';`,
      errors: [{ messageId: 'serverOnly' }],
    },
    {
      name: 'a dynamic import bundles just as thoroughly as a static one',
      filename: 'src/ui/Badge.tsx',
      code: `'use client';\nexport async function load() { return import('@/repositories/snapshots'); }`,
      errors: [{ messageId: 'serverOnly' }],
    },
  ],
});
