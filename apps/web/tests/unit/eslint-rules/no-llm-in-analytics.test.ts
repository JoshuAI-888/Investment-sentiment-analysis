import rule from '../../../eslint-rules/no-llm-in-analytics';
import { asEslintRule, ruleTester } from './rule-tester';

ruleTester.run('no-llm-in-analytics', asEslintRule(rule), {
  valid: [
    {
      name: 'analytics importing a contract',
      filename: 'src/analytics/attention.ts',
      code: `import type { AttentionSnapshot } from '@/contracts/attention';`,
    },
    {
      name: 'services may call the agent layer — that is where orchestration belongs',
      filename: 'src/services/research.ts',
      code: `import { runAgent } from '@/agent/agent';`,
    },
    {
      name: 'a model SDK outside the governed layers',
      filename: 'src/agent/modelClient.ts',
      code: `import OpenAI from 'openai';`,
    },
    {
      name: 'a package whose name merely contains "ai"',
      filename: 'src/analytics/returns.ts',
      code: `import { chain } from 'lodash/fp';`,
    },
  ],
  invalid: [
    {
      name: 'analytics importing the agent layer',
      filename: 'src/analytics/sentiment.ts',
      code: `import { classify } from '@/agent/agent';`,
      errors: [{ messageId: 'agentImport' }],
    },
    {
      name: 'analytics importing the agent layer relatively',
      filename: 'src/analytics/sentiment.ts',
      code: `import { classify } from '../agent/agent';`,
      errors: [{ messageId: 'agentImport' }],
    },
    {
      name: 'calc importing a model SDK',
      filename: 'src/calc/composite.ts',
      code: `import Anthropic from '@anthropic-ai/sdk';`,
      errors: [{ messageId: 'modelSdk' }],
    },
    {
      name: 'the ai-sdk scope',
      filename: 'src/analytics/sentiment.ts',
      code: `import { generateText } from '@ai-sdk/openai';`,
      errors: [{ messageId: 'modelSdk' }],
    },
    {
      name: 'a dynamic import walks past a rule that only checks ImportDeclaration',
      filename: 'src/analytics/sentiment.ts',
      code: `export async function score() { const mod = await import('openai'); return mod; }`,
      errors: [{ messageId: 'modelSdk' }],
    },
    {
      name: 'so does require()',
      filename: 'src/analytics/sentiment.ts',
      code: `const OpenAI = require('openai');`,
      errors: [{ messageId: 'modelSdk' }],
    },
    {
      name: 're-exporting the agent layer is still importing it',
      filename: 'src/analytics/index.ts',
      code: `export { classify } from '@/agent/agent';`,
      errors: [{ messageId: 'agentImport' }],
    },
  ],
});
