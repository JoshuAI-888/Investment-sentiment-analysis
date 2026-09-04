import type { TSESTree } from '@typescript-eslint/utils';
import { createRule } from './create-rule';
import { layerOfFile } from './layers';

/**
 * D-09 / F22 §4.2 — a bitemporal read outside `asOf` fails the build.
 *
 * **This ships from F01 as a stub that passes on empty**, and that is deliberate: there are no
 * bitemporal tables until F22. A rule added after the code it governs is a rule that never
 * fires, so the mechanism lands first and F22 supplies `bitemporalTables` and the test that
 * proves it bites.
 *
 * What it looks for: a repository function that names a bitemporal table in a query string
 * while taking no `asOf` parameter. A point-in-time table read without an as-of bound returns
 * whatever is true *now*, which silently backfills history and makes every downstream
 * evaluation look better than it was.
 */
type Options = [{ readonly bitemporalTables: readonly string[] }];

const AS_OF = /\basOf\b/;

function namesAsOf(node: TSESTree.Node | undefined, source: string): boolean {
  if (node === undefined) return false;
  return AS_OF.test(source.slice(node.range[0], node.range[1]));
}

type FunctionNode =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

export default createRule<Options, 'unboundedRead'>({
  name: 'no-unbounded-pit-read',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid a repository read of a bitemporal table that is not bounded by asOf (D-09, F22 §4.2).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          bitemporalTables: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unboundedRead:
        "'{{table}}' is bitemporal and this read is not bounded by asOf. A point-in-time table read without an as-of bound returns what is true now, not what was knowable then — it backfills history silently and every downstream evaluation looks better than it was (D-09, F22 §4.2).",
    },
  },
  defaultOptions: [{ bitemporalTables: [] }],
  create(context, [options]) {
    const tables = options.bitemporalTables;
    // Passes on empty. F22 supplies the table set.
    if (tables.length === 0) return {};

    const layer = layerOfFile(context.filename);
    if (layer !== 'repositories') return {};

    const source = context.sourceCode.getText();
    const functionStack: FunctionNode[] = [];

    const enter = (node: FunctionNode): void => {
      functionStack.push(node);
    };
    const exit = (): void => {
      functionStack.pop();
    };

    function checkText(text: string, node: TSESTree.Node): void {
      // A READ, not any mention. `insert into market_snapshot ... returning *` names the table
      // and reads back the row it just wrote — trivially point-in-time correct, and reporting
      // it is the cry-wolf failure that gets a rule switched off. `delete from` is retention's
      // business (F22 §4.3) and the append-only triggers already reject it.
      if (/^\s*(insert|update|delete)\b/i.test(text.trimStart())) return;

      const table = tables.find((name) =>
        new RegExp(`\\b(from|join)\\s+["'\`]?${name}\\b`, 'i').test(text),
      );
      if (table === undefined) return;

      const enclosing = functionStack[functionStack.length - 1];
      if (enclosing !== undefined) {
        const paramsNameAsOf = enclosing.params.some((param) => namesAsOf(param, source));
        if (paramsNameAsOf && namesAsOf(enclosing.body, source)) return;
      }

      context.report({ node, messageId: 'unboundedRead', data: { table } });
    }

    return {
      FunctionDeclaration: enter,
      'FunctionDeclaration:exit': exit,
      FunctionExpression: enter,
      'FunctionExpression:exit': exit,
      ArrowFunctionExpression: enter,
      'ArrowFunctionExpression:exit': exit,

      Literal(node: TSESTree.Literal) {
        if (typeof node.value !== 'string') return;
        checkText(node.value, node);
      },
      TemplateLiteral(node: TSESTree.TemplateLiteral) {
        checkText(node.quasis.map((quasi) => quasi.value.raw).join(' '), node);
      },
    };
  },
});
