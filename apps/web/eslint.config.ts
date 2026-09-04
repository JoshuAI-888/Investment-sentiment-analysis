import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import architecture from './eslint-rules/index';
import { BITEMPORAL_TABLES } from './src/contracts/bitemporal';

/**
 * F01 §4.3. The five `architecture/*` rules below are the load-bearing part of this file:
 * they encode product invariants that review alone has never been able to hold.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      'next-env.d.ts',
      // Deliberate violations, kept as the corpus the rule tests and check:* tests run against.
      'tests/fixtures/violations/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // TypeScript resolves identifiers itself, and `no-undef` has no type information to do it
    // with — it reports DOM and Node globals as undefined in files that legitimately use them.
    rules: { 'no-undef': 'off' },
  },

  {
    plugins: { architecture },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },

  {
    // The layered tree. Everything outside it (config, scripts, lint rules, tests) is not
    // governed by 02-ARCHITECTURE-CONTRACTS.md §3 and is not linted by these rules.
    files: ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
    rules: {
      'architecture/no-llm-in-analytics': 'error',
      'architecture/no-float-in-analytics': 'error',
      'architecture/no-server-import-in-client': 'error',
      'architecture/layer-direction': 'error',
      // Armed by F22. F01 shipped this passing on empty so it would have gated every commit
      // by the time it had something to gate; the table set is now real, and a repository
      // method reading one of these outside `asOf` fails the build.
      'architecture/no-unbounded-pit-read': [
        'error',
        { bitemporalTables: [...BITEMPORAL_TABLES] },
      ],
      // F03 DoD item 9. Repositories are the only modules that contain SQL.
      'architecture/no-sql-outside-repositories': 'error',
    },
  },

  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts', 'eslint-rules/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
