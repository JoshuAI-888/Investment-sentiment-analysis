import { createRule, importVisitors } from './create-rule';
import { ALLOWED_IMPORTS, layerOfFile, layerOfImport } from './layers';

export default createRule({
  name: 'layer-direction',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce the dependency direction in 02-ARCHITECTURE-CONTRACTS.md §3. A dependency that points the other way is a review failure; this makes it a build failure.',
    },
    schema: [],
    messages: {
      wrongDirection:
        '{{from}}/ must not import {{to}}/ ({{specifier}}). 02-ARCHITECTURE-CONTRACTS.md §3 allows {{from}}/ to import: {{allowed}}. A dependency pointing the other way inverts the layering and takes the lower layer’s testability with it.',
      noImports:
        '{{from}}/ must not import {{to}}/ ({{specifier}}). Contracts are the shared vocabulary and depend on nothing — that is what lets every other layer depend on them without a cycle.',
    },
  },
  defaultOptions: [],
  create(context) {
    const from = layerOfFile(context.filename);
    if (from === undefined) return {};

    const allowed = ALLOWED_IMPORTS[from];

    return importVisitors(({ specifier, node }) => {
      const to = layerOfImport(specifier, from);
      if (to === undefined || to === from) return;
      if (allowed.includes(to)) return;

      context.report({
        node,
        messageId: allowed.length === 0 ? 'noImports' : 'wrongDirection',
        data: {
          from,
          to,
          specifier,
          allowed: allowed.length === 0 ? 'nothing' : allowed.map((layer) => `${layer}/`).join(', '),
        },
      });
    });
  },
});
