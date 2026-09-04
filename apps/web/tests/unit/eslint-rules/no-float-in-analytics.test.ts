import rule from '../../../eslint-rules/no-float-in-analytics';
import { asEslintRule, ruleTester } from './rule-tester';

ruleTester.run('no-float-in-analytics', asEslintRule(rule), {
  valid: [
    {
      name: 'decimal arithmetic through a helper',
      filename: 'src/analytics/returns.ts',
      code: `import { divide } from '@/contracts/decimal'; export const half = (x: string) => divide(x, '2');`,
    },
    {
      name: 'a numeric literal that is not in arithmetic',
      filename: 'src/analytics/returns.ts',
      code: `export const WINDOW_DAYS = 14;`,
    },
    {
      name: 'the same arithmetic outside the governed layers',
      filename: 'src/services/jobs/dispatch.ts',
      code: `export const next = (n: number) => n + 1;`,
    },
    {
      name: 'Number() outside the governed layers',
      filename: 'src/adapters/fmp.ts',
      code: `export const parse = (raw: string) => Number(raw);`,
    },
  ],
  invalid: [
    {
      name: 'a numeric literal in arithmetic',
      filename: 'src/analytics/returns.ts',
      code: `export const bump = (x: number) => x + 1;`,
      errors: [{ messageId: 'literalArithmetic' }],
    },
    {
      name: 'a float literal in arithmetic',
      filename: 'src/analytics/confidence.ts',
      code: `export const scale = (x: number) => x * 0.5;`,
      errors: [{ messageId: 'literalArithmetic' }],
    },
    {
      name: 'a negated literal is the same defect in a different node type',
      filename: 'src/analytics/confidence.ts',
      code: `export const shift = (x: number) => x * -1;`,
      errors: [{ messageId: 'literalArithmetic' }],
    },
    {
      name: 'Number() in analytics',
      filename: 'src/analytics/sentiment.ts',
      code: `export const parse = (raw: string) => Number(raw);`,
      errors: [{ messageId: 'coercion' }],
    },
    {
      name: 'parseFloat() in calc',
      filename: 'src/calc/composite.ts',
      code: `export const parse = (raw: string) => parseFloat(raw);`,
      errors: [{ messageId: 'coercion' }],
    },
    {
      name: 'both operands are literals — both are reported',
      filename: 'src/analytics/returns.ts',
      code: `export const ratio = 3 / 7;`,
      errors: [{ messageId: 'literalArithmetic' }, { messageId: 'literalArithmetic' }],
    },
  ],
});
