/**
 * F21 §4.2 `open_calculation` — "The `CalculationArtifact` with inputs, steps, exact decimal,
 * hashes. **'How was this computed?'**" Reads through `services/calculations.ts#loadArtifact`
 * (F05) directly — the exact reviewed round-trip the Inspector itself uses
 * (`tests/contract/artifact-round-trip.test.ts` pins it byte-for-byte on the decimals). F21 adds
 * no computation and no second read path.
 */
import { z } from 'zod';
import { loadArtifact } from '@/services/calculations';
import { buildEnvelope } from '../envelope';
import type { McpToolResultEnvelope } from '../contract';
import { McpToolError } from './errors';

export const openCalculationInputSchema = {
  type: 'object',
  properties: { calculationId: { type: 'string', description: 'The calculationId to open (a uuid).' } },
  required: ['calculationId'],
  additionalProperties: false,
} as const;

const inputZod = z.object({ calculationId: z.string().min(1) });

export async function openCalculation(rawArgs: unknown): Promise<McpToolResultEnvelope> {
  const args = inputZod.safeParse(rawArgs);
  if (!args.success) throw new McpToolError('invalid_arguments', `open_calculation: ${args.error.message}`);

  const artifact = await loadArtifact(args.data.calculationId);
  if (artifact === null) {
    throw new McpToolError(
      'unresolvable_calculation',
      `No calculation is on record for id '${args.data.calculationId}'.`,
    );
  }

  return buildEnvelope({
    tool: 'open_calculation',
    data: {
      calculationId: artifact.calculationId,
      methodId: artifact.methodId,
      methodVersion: artifact.methodVersion,
      subject: artifact.subject,
      asOf: artifact.asOf,
      inputs: artifact.inputs,
      assumptions: artifact.assumptions,
      steps: artifact.steps,
      result: artifact.result,
      abstention: artifact.abstention,
      eligibility: artifact.eligibility,
      inputHash: artifact.inputHash,
      resultHash: artifact.resultHash,
      configVersion: artifact.configVersion,
      points: artifact.points,
      warnings: artifact.warnings,
      computedAt: artifact.computedAt,
    },
    coverage: [],
    // A single calculation is not a sampled aggregate the way a stance score is — its own inputs
    // carry whatever `n` its method used, already visible in `steps`/`inputs` above.
    n: null,
    window: null,
    limitations: [],
    mustNotClaim: [
      'This is one recorded computation, replayable against its own inputs. It is not, by itself, a claim about the method\'s track record.',
    ],
    calculationIds: [artifact.calculationId],
  });
}
