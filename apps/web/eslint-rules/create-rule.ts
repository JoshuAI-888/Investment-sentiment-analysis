import { ESLintUtils, type TSESTree } from '@typescript-eslint/utils';

export const createRule = ESLintUtils.RuleCreator(
  (name) => `docs/features/F01-foundation-quality-gates.md#43-architectural-lint-rules (${name})`,
);

/** Every syntactic form that brings another module into this one. */
export type ImportSite = {
  readonly specifier: string;
  readonly node: TSESTree.Node;
};

type Visitor = (site: ImportSite) => void;

/**
 * Static imports, re-exports, dynamic `import()` and `require()`. A rule that only checks
 * `ImportDeclaration` is a rule that a `require()` walks straight past.
 */
export function importVisitors(visit: Visitor): Record<string, (node: never) => void> {
  const fromSource = (node: {
    source: TSESTree.StringLiteral | null | undefined;
  }): void => {
    if (node.source == null) return;
    visit({ specifier: node.source.value, node: node.source });
  };

  return {
    ImportDeclaration: (node: TSESTree.ImportDeclaration) => fromSource(node),
    ExportNamedDeclaration: (node: TSESTree.ExportNamedDeclaration) => fromSource(node),
    ExportAllDeclaration: (node: TSESTree.ExportAllDeclaration) => fromSource(node),
    ImportExpression: (node: TSESTree.ImportExpression) => {
      if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
        visit({ specifier: node.source.value, node: node.source });
      }
    },
    CallExpression: (node: TSESTree.CallExpression) => {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
      const [first] = node.arguments;
      if (first?.type === 'Literal' && typeof first.value === 'string') {
        visit({ specifier: first.value, node: first });
      }
    },
  } as Record<string, (node: never) => void>;
}

/** True when the file carries a top-of-file `'use client'` directive. */
export function isClientModule(program: TSESTree.Program): boolean {
  for (const statement of program.body) {
    if (statement.type !== 'ExpressionStatement') break;
    const { expression } = statement;
    if (expression.type !== 'Literal' || typeof expression.value !== 'string') break;
    if (expression.value === 'use client') return true;
  }
  return false;
}
