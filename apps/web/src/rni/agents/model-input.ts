import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

export type RniSerializedModelInput = {
  readonly canonicalJson: string;
  readonly dynamicInputHash: string;
  readonly dynamicSuffix: string;
};

const sortJson = (value: unknown): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('RNI model input contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  throw new Error(`RNI model input contains non-JSON ${typeof value}`);
};

export const serializeRniModelInputJson = (input: unknown): string =>
  JSON.stringify(sortJson(input));

export const hashRniModelInput = (input: unknown): string =>
  createHash('sha256').update(serializeRniModelInputJson(input), 'utf8').digest('hex');

export const hashRniSerializedModelInput = (serialized: string): string =>
  createHash('sha256').update(serialized, 'utf8').digest('hex');

export const serializeRniModelInput = (
  input: unknown,
  finalInstruction: string,
): RniSerializedModelInput => {
  const canonicalJson = serializeRniModelInputJson(input);
  const encoded = Buffer.from(canonicalJson, 'utf8').toString('base64url');
  const byteLength = Buffer.byteLength(canonicalJson, 'utf8');
  return {
    canonicalJson,
    dynamicInputHash: createHash('sha256').update(canonicalJson, 'utf8').digest('hex'),
    dynamicSuffix:
      `<rni_dynamic_input encoding="base64url" bytes="${String(byteLength)}">\n` +
      `${encoded}\n</rni_dynamic_input>\n${finalInstruction}`,
  };
};
