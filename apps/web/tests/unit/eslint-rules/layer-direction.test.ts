import rule from '../../../eslint-rules/layer-direction';
import { asEslintRule, ruleTester } from './rule-tester';

ruleTester.run('layer-direction', asEslintRule(rule), {
  valid: [
    {
      name: 'services may import repositories',
      filename: 'src/services/dashboard.ts',
      code: `import { findSnapshot } from '@/repositories/snapshots';`,
    },
    {
      name: 'services may import adapters',
      filename: 'src/services/collect.ts',
      code: `import { fetchQuote } from '@/adapters/fmp';`,
    },
    {
      name: 'services may import analytics',
      filename: 'src/services/dashboard.ts',
      code: `import { composite } from '@/analytics/marketComposite';`,
    },
    {
      name: 'analytics may import contracts',
      filename: 'src/analytics/attention.ts',
      code: `import type { Snapshot } from '@/contracts/attention';`,
    },
    {
      name: 'a page may import a service and a ui component',
      filename: 'app/(app)/dashboard/page.tsx',
      code: `import { getDashboard } from '@/services/dashboard';\nimport { Badge } from '@/ui/Badge';`,
    },
    {
      name: 'a relative import inside the same layer',
      filename: 'src/analytics/attention.ts',
      code: `import { helper } from './helper';`,
    },
    {
      name: 'a package import is not a layer edge',
      filename: 'src/contracts/attention.ts',
      code: `import { z } from 'zod';`,
    },
    {
      name: 'files outside the layered tree are ungoverned',
      filename: 'scripts/seed.ts',
      code: `import { findSnapshot } from '@/repositories/snapshots';`,
    },
  ],
  invalid: [
    {
      name: 'contracts may import nothing — that is what keeps them acyclic',
      filename: 'src/contracts/attention.ts',
      code: `import { findSnapshot } from '@/repositories/snapshots';`,
      errors: [{ messageId: 'noImports' }],
    },
    {
      name: 'a repository reaching up into services',
      filename: 'src/repositories/snapshots.ts',
      code: `import { getDashboard } from '@/services/dashboard';`,
      errors: [{ messageId: 'wrongDirection' }],
    },
    {
      name: 'analytics reaching a repository — it depends only on contracts',
      filename: 'src/analytics/attention.ts',
      code: `import { findSnapshot } from '@/repositories/snapshots';`,
      errors: [{ messageId: 'wrongDirection' }],
    },
    {
      name: 'analytics reaching an adapter is the same defect with I/O attached',
      filename: 'src/analytics/attention.ts',
      code: `import { fetchQuote } from '@/adapters/fmp';`,
      errors: [{ messageId: 'wrongDirection' }],
    },
    {
      name: 'a ui component reaching a repository cannot be tested or reused',
      filename: 'src/ui/Table.tsx',
      code: `import { findSnapshot } from '@/repositories/snapshots';`,
      errors: [{ messageId: 'wrongDirection' }],
    },
    {
      name: 'an adapter reaching across to a repository',
      filename: 'src/adapters/fmp.ts',
      code: `import { findSnapshot } from '@/repositories/snapshots';`,
      errors: [{ messageId: 'wrongDirection' }],
    },
    {
      name: 'a page reaching straight past services into a repository',
      filename: 'app/(app)/dashboard/page.tsx',
      code: `import { findSnapshot } from '@/repositories/snapshots';`,
      errors: [{ messageId: 'wrongDirection' }],
    },
    {
      name: 'a relative path that climbs into another layer is still an edge',
      filename: 'src/analytics/attention.ts',
      code: `import { findSnapshot } from '../repositories/snapshots';`,
      errors: [{ messageId: 'wrongDirection' }],
    },
  ],
});
