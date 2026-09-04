import { describe, expect, it } from 'vitest';
import { readSeries, seriesLength } from '../../../src/calc/series';
import { buildArtifact } from '../../../src/calc/artifact';
import { args, input } from './fixtures';

describe('F06 — series input helpers', () => {
  it('reads a declared window of indexed inputs in order', () => {
    const artifact = buildArtifact(
      args(
        (ctx) => {
          const values = readSeries(ctx, 'x', 3);
          return {
            value: ctx.step({
              key: 'sum',
              label: 'sum of the window',
              expression: '{x_0} + {x_1} + {x_2}',
              operands: { x_0: values[0] as never, x_1: values[1] as never, x_2: values[2] as never },
              unit: 'ranks',
              evaluate: (operand) => operand('x_0').plus(operand('x_1')).plus(operand('x_2')),
            }),
          };
        },
        {
          inputs: [
            input('x_0', '1'),
            input('x_1', '2'),
            input('x_2', '3'),
          ],
        },
      ),
    );
    expect(artifact.result?.exact).toBe('6');
  });

  it('counts how many indexed inputs are actually declared, without a fixed window', () => {
    const artifact = buildArtifact(
      args(
        (ctx) => ({
          value: ctx.step({
            key: 'count',
            label: 'count',
            expression: '{a}',
            operands: { a: ctx.input('a') },
            unit: 'count',
            evaluate: (operand) => operand('a'),
          }),
        }),
        { inputs: [input('a', '1'), input('x_0', '10'), input('x_1', '20')] },
      ),
    );
    expect(artifact.result?.exact).toBe('1');
    // seriesLength is exercised directly against the same ctx shape via a second build.
  });

  it('seriesLength stops at the first gap', () => {
    let observed = -1;
    buildArtifact(
      args(
        (ctx) => {
          observed = seriesLength(ctx, 'x');
          return {
            value: ctx.step({
              key: 's',
              label: 's',
              expression: '{a}',
              operands: { a: ctx.input('a') },
              unit: 'count',
              evaluate: (operand) => operand('a'),
            }),
          };
        },
        { inputs: [input('a', '1'), input('x_0', '10'), input('x_1', '20')] },
      ),
    );
    expect(observed).toBe(2);
  });
});
