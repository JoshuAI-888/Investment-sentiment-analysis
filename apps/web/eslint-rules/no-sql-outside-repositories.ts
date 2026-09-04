import type { TSESTree } from '@typescript-eslint/utils';
import { createRule } from './create-rule';
import { layerOfFile } from './layers';

/**
 * F03 DoD item 9 — "repositories are the only modules containing SQL, enforced by lint".
 *
 * The rule exists because the alternative failure is silent and cumulative: one `select` in a
 * service, then one in a route handler, and the layer that was supposed to own persistence owns
 * a subset of it. By the time anyone notices, the PIT guard F22 installs in the repositories
 * has holes nobody can enumerate — `no-unbounded-pit-read` only inspects `repositories/`,
 * because that is where the reads were supposed to be.
 */
/**
 * Anchored at the start of the string, because a SQL string literal begins with its verb and
 * an English sentence containing the same word does not begin as a statement.
 *
 * The `from` target additionally excludes English determiners. Without that, "Select a ticker
 * from the list" reports as a query — which is the cry-wolf failure that gets a rule disabled
 * on its second PR rather than argued with on its first.
 */
const DETERMINER = 'the|a|an|my|your|our|its|this|that|these|those|it|them|any|each|all';

const SQL_STATEMENT = new RegExp(
  [
    `^\\s*select\\b[\\s\\S]*?\\bfrom\\s+(?!(?:${DETERMINER})\\b)["\`']?[a-z_][a-z0-9_$.]*`,
    '^\\s*insert\\s+into\\s+["`\']?[a-z_]',
    '^\\s*update\\s+["`\']?[a-z_][a-z0-9_$."`\']*\\s+set\\b',
    `^\\s*delete\\s+from\\s+(?!(?:${DETERMINER})\\b)["\`']?[a-z_]`,
    '^\\s*(create|drop)\\s+(table|index|trigger|schema|extension)\\b',
    '^\\s*alter\\s+table\\b',
    '^\\s*truncate\\s+table\\b',
  ].join('|'),
  'i',
);

/** Where SQL is legitimate: the repositories layer, migrations, and the tests that exercise them. */
function isAllowed(filename: string): boolean {
  const normalised = filename.replaceAll('\\', '/');
  if (layerOfFile(normalised) === 'repositories') return true;
  if (/(^|\/)migrations\//.test(normalised)) return true;
  if (/(^|\/)tests\//.test(normalised)) return true;
  if (/(^|\/)scripts\//.test(normalised)) return true;
  return false;
}

export default createRule({
  name: 'no-sql-outside-repositories',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid SQL outside repositories/. Persistence that leaks upward takes the point-in-time guard with it.',
    },
    schema: [],
    messages: {
      sqlOutsideRepositories:
        'SQL in {{layer}}/. Repositories are the only modules that contain SQL (F03 DoD item 9). A query here is invisible to `no-unbounded-pit-read`, which inspects repositories/ — so a bitemporal read from this file would never be bounded by asOf and nothing would report it.',
    },
  },
  defaultOptions: [],
  create(context) {
    if (isAllowed(context.filename)) return {};

    const layer = layerOfFile(context.filename);
    if (layer === undefined) return {};

    function check(node: TSESTree.Node, text: string): void {
      if (!SQL_STATEMENT.test(text)) return;
      context.report({ node, messageId: 'sqlOutsideRepositories', data: { layer } });
    }

    return {
      Literal(node: TSESTree.Literal) {
        if (typeof node.value !== 'string') return;
        check(node, node.value);
      },
      TemplateLiteral(node: TSESTree.TemplateLiteral) {
        check(node, node.quasis.map((quasi) => quasi.value.raw).join(' '));
      },
    };
  },
});
