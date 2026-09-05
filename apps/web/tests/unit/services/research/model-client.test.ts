import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createFixtureModelClient, createGatewayModelClient, ModelClientSchemaError } from '../../../../src/services/research/model-client';

const SCHEMA = z.object({ ok: z.literal(true) });

describe('createFixtureModelClient', () => {
  it('parses the responder output against the caller-supplied schema', async () => {
    const model = createFixtureModelClient(() => ({ ok: true }));
    const result = await model.synthesize('synthesis', { prompt: 'p', context: {} }, SCHEMA);
    expect(result).toEqual({ ok: true });
  });

  it('throws a ModelClientSchemaError when the responder returns the wrong shape', async () => {
    const model = createFixtureModelClient(() => ({ ok: false }));
    await expect(model.synthesize('synthesis', { prompt: 'p', context: {} }, SCHEMA)).rejects.toThrow(ModelClientSchemaError);
  });

  it('never makes a network call — the responder is a plain function', async () => {
    let called = false;
    const model = createFixtureModelClient((task) => {
      called = true;
      expect(task).toBe('verify');
      return { ok: true };
    });
    await model.verify('verify', { prompt: 'p', context: {} }, SCHEMA);
    expect(called).toBe(true);
  });
});

describe('createGatewayModelClient', () => {
  it('refuses construction when synthesis and verify share the same model (D-34)', () => {
    expect(() =>
      createGatewayModelClient({ apiKey: 'k', synthesisModel: 'model-a', verifyModel: 'model-a', fastModel: 'model-c' }),
    ).toThrow(/different vendors/);
  });

  it('constructs without a network call when the two models differ', () => {
    expect(() =>
      createGatewayModelClient({ apiKey: 'k', synthesisModel: 'model-a', verifyModel: 'model-b', fastModel: 'model-c' }),
    ).not.toThrow();
  });
});
