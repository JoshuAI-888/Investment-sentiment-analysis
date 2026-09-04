import type { TSESTree } from '@typescript-eslint/utils';
import { createRule, importVisitors, isClientModule } from './create-rule';

type ServerOnly = { readonly label: string; readonly test: (specifier: string) => boolean };

const SERVER_ONLY: readonly ServerOnly[] = [
  {
    label: 'env.ts',
    test: (s) => s === '@/env' || /(?:^|\/)env(?:\.ts|\.js)?$/.test(s),
  },
  {
    label: 'repositories/',
    test: (s) => s.startsWith('@/repositories') || /(?:^|\/)repositories\//.test(s),
  },
  {
    label: 'adapters/',
    test: (s) => s.startsWith('@/adapters') || /(?:^|\/)adapters\//.test(s),
  },
];

export default createRule({
  name: 'no-server-import-in-client',
  meta: {
    type: 'problem',
    docs: {
      description:
        "Forbid env.ts, repositories/ and adapters/ imports from a 'use client' module. Reaching one of these from the client is how a secret or a database client ends up in a browser chunk.",
    },
    schema: [],
    messages: {
      serverOnly:
        "'{{specifier}}' is server-only ({{label}}) and this module is 'use client'. It would be bundled for the browser — a secret in a client chunk is a published secret. Fetch the data in a server component and pass it down as props.",
    },
  },
  defaultOptions: [],
  create(context) {
    let isClient = false;

    return {
      Program(node: TSESTree.Program) {
        isClient = isClientModule(node);
      },
      ...importVisitors(({ specifier, node }) => {
        if (!isClient) return;
        const hit = SERVER_ONLY.find((entry) => entry.test(specifier));
        if (hit === undefined) return;
        context.report({ node, messageId: 'serverOnly', data: { specifier, label: hit.label } });
      }),
    };
  },
});
