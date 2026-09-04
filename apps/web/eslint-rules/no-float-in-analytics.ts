import type { TSESTree } from '@typescript-eslint/utils';
import { createRule } from './create-rule';
import { layerOfFile } from './layers';

const GOVERNED_LAYERS = new Set(['analytics', 'calc']);

const ARITHMETIC = new Set(['+', '-', '*', '/', '%', '**']);

/** `Number(x)` and `parseFloat(x)` are the two coercions that silently produce a float. */
const FLOAT_COERCIONS = new Set(['Number', 'parseFloat']);

function isNumericLiteral(node: TSESTree.Node): boolean {
  return node.type === 'Literal' && typeof node.value === 'number';
}

export default createRule({
  name: 'no-float-in-analytics',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid numeric literals in arithmetic and float coercions inside analytics/ and calc/. IEEE 754 rounding in a published metric is a defect nobody can see in review.',
    },
    schema: [],
    messages: {
      literalArithmetic:
        'Arithmetic on the numeric literal {{value}} in {{layer}}/. These modules use decimals, never floats — a raw JS number here is a review failure (CLAUDE.md). Use the decimal helpers and a named constant.',
      coercion:
        '{{callee}}() produces a float. {{layer}}/ must carry decimals end to end — a coercion here is where the precision is lost, and the loss will not reproduce across platforms.',
    },
  },
  defaultOptions: [],
  create(context) {
    const layer = layerOfFile(context.filename);
    if (layer === undefined || !GOVERNED_LAYERS.has(layer)) return {};

    return {
      BinaryExpression(node: TSESTree.BinaryExpression) {
        if (!ARITHMETIC.has(node.operator)) return;

        for (const side of [node.left, node.right]) {
          if (isNumericLiteral(side)) {
            context.report({
              node: side,
              messageId: 'literalArithmetic',
              data: { value: String((side as TSESTree.Literal).value), layer },
            });
          }
        }
      },

      UnaryExpression(node: TSESTree.UnaryExpression) {
        // `-1` as an operand is the same defect wearing a different node type.
        if (node.operator !== '-' && node.operator !== '+') return;
        if (node.parent.type !== 'BinaryExpression') return;
        if (!ARITHMETIC.has(node.parent.operator)) return;
        if (!isNumericLiteral(node.argument)) return;

        context.report({
          node,
          messageId: 'literalArithmetic',
          data: { value: `${node.operator}${String((node.argument as TSESTree.Literal).value)}`, layer },
        });
      },

      CallExpression(node: TSESTree.CallExpression) {
        if (node.callee.type !== 'Identifier') return;
        if (!FLOAT_COERCIONS.has(node.callee.name)) return;

        context.report({
          node,
          messageId: 'coercion',
          data: { callee: node.callee.name, layer },
        });
      },
    };
  },
});
