import { createRule, importVisitors } from './create-rule';
import { layerOfFile } from './layers';

/**
 * Model SDKs. The list is by package name because that is what an import statement carries;
 * an SDK added to the stack later must be added here, and the review step for any new model
 * dependency is to ask whether this list needs it.
 */
const MODEL_SDKS: readonly (string | RegExp)[] = [
  'openai',
  'ai',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
  '@google/genai',
  '@azure/openai',
  '@huggingface/inference',
  '@mistralai/mistralai',
  'cohere-ai',
  'langchain',
  /^@ai-sdk\//,
  /^@langchain\//,
];

const GOVERNED_LAYERS = new Set(['analytics', 'calc']);

function isModelSdk(specifier: string): boolean {
  return MODEL_SDKS.some((entry) =>
    typeof entry === 'string' ? specifier === entry || specifier.startsWith(`${entry}/`) : entry.test(specifier),
  );
}

function isAgentImport(specifier: string): boolean {
  return specifier.startsWith('@/agent') || /(?:^|\/)agent\//.test(specifier);
}

export default createRule({
  name: 'no-llm-in-analytics',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid any import from agent/ or a model SDK inside analytics/ or calc/. A metric a model can influence is a metric nobody can reproduce.',
    },
    schema: [],
    messages: {
      agentImport:
        "'{{specifier}}' reaches the agent layer from {{layer}}/. Analytics depends only on contracts (02-ARCHITECTURE-CONTRACTS.md §3) — a deterministic metric that can call a model is no longer deterministic, and its Inspector record would be unreproducible.",
      modelSdk:
        "'{{specifier}}' is a model SDK and {{layer}}/ must stay deterministic. Move the call into services/ and pass the result in as data.",
    },
  },
  defaultOptions: [],
  create(context) {
    const layer = layerOfFile(context.filename);
    if (layer === undefined || !GOVERNED_LAYERS.has(layer)) return {};

    return importVisitors(({ specifier, node }) => {
      if (isAgentImport(specifier)) {
        context.report({ node, messageId: 'agentImport', data: { specifier, layer } });
        return;
      }
      if (isModelSdk(specifier)) {
        context.report({ node, messageId: 'modelSdk', data: { specifier, layer } });
      }
    });
  },
});
