import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';

/**
 * One tester, shared. ESLint's RuleTester discovers `describe`/`it` from the global scope,
 * which vitest provides.
 */
export const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser as unknown as NonNullable<
      NonNullable<ConstructorParameters<typeof RuleTester>[0]>['languageOptions']
    >['parser'],
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

/** The rules are authored against @typescript-eslint's types; RuleTester wants ESLint's. */
export const asEslintRule = (rule: unknown) => rule as never;
