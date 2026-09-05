import { z } from 'zod';

export interface RniInputSchemaAuthorityArray
  extends ReadonlyArray<RniInputSchemaAuthorityValue> {
  readonly [index: number]: RniInputSchemaAuthorityValue;
}
export interface RniInputSchemaAuthorityObject {
  readonly [key: string]: RniInputSchemaAuthorityValue;
}
export type RniInputSchemaAuthorityValue =
  | boolean
  | null
  | number
  | string
  | RniInputSchemaAuthorityArray
  | RniInputSchemaAuthorityObject;

type RefinementRule =
  | Readonly<{
      kind: 'forbid_string_pattern';
      field: string;
      pattern: string;
      flags: string;
      issuePath: readonly string[];
      message: string;
    }>
  | Readonly<{
      kind: 'ordered_instants';
      earlierField: string;
      laterField: string;
      issuePath: readonly string[];
      message: string;
    }>
  | Readonly<{
      kind: 'unique_case_insensitive_strings';
      field: string;
      issuePath: readonly string[];
      message: string;
    }>
  | Readonly<{
      kind: 'nonempty_array_when_literal';
      discriminantField: string;
      discriminantValue: string;
      arrayField: string;
      issuePath: readonly string[];
      message: string;
    }>
  | Readonly<{
      kind: 'nullable_ordered_offsets';
      startField: string;
      endField: string;
      issuePath: readonly string[];
      message: string;
    }>
  | Readonly<{
      kind: 'literal_requires_literal';
      whenField: string;
      whenValue: string;
      requiredField: string;
      requiredValue: string;
      issuePath: readonly string[];
      message: string;
    }>
  | Readonly<{
      kind: 'literal_forbids_literal';
      whenField: string;
      whenValue: string;
      forbiddenField: string;
      forbiddenValue: string;
      issuePath: readonly string[];
      message: string;
    }>;

const refinementRules = new WeakMap<z.ZodTypeAny, readonly RefinementRule[]>();

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  value as Readonly<Record<string, unknown>>;

const addIssue = (context: z.RefinementCtx, rule: RefinementRule): void => {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: [...rule.issuePath],
    message: rule.message,
  });
};

const applyRule = (value: unknown, rule: RefinementRule, context: z.RefinementCtx): void => {
  const input = record(value);
  switch (rule.kind) {
    case 'forbid_string_pattern': {
      const candidate = input[rule.field];
      if (typeof candidate === 'string' && new RegExp(rule.pattern, rule.flags).test(candidate)) {
        addIssue(context, rule);
      }
      return;
    }
    case 'ordered_instants': {
      const earlier = input[rule.earlierField];
      const later = input[rule.laterField];
      if (
        typeof earlier === 'string' &&
        typeof later === 'string' &&
        new Date(later).getTime() <= new Date(earlier).getTime()
      ) {
        addIssue(context, rule);
      }
      return;
    }
    case 'unique_case_insensitive_strings': {
      const values = input[rule.field];
      if (
        Array.isArray(values) &&
        new Set(values.map((item) => String(item).toLowerCase())).size !== values.length
      ) {
        addIssue(context, rule);
      }
      return;
    }
    case 'nonempty_array_when_literal': {
      const candidate = input[rule.arrayField];
      if (
        input[rule.discriminantField] === rule.discriminantValue &&
        Array.isArray(candidate) &&
        candidate.length === 0
      ) {
        addIssue(context, rule);
      }
      return;
    }
    case 'nullable_ordered_offsets': {
      const start = input[rule.startField];
      const end = input[rule.endField];
      if (
        start !== null &&
        end !== null &&
        typeof start === 'number' &&
        typeof end === 'number' &&
        end <= start
      ) {
        addIssue(context, rule);
      }
      return;
    }
    case 'literal_requires_literal': {
      if (
        input[rule.whenField] === rule.whenValue &&
        input[rule.requiredField] !== rule.requiredValue
      ) {
        addIssue(context, rule);
      }
      return;
    }
    case 'literal_forbids_literal': {
      if (
        input[rule.whenField] === rule.whenValue &&
        input[rule.forbiddenField] === rule.forbiddenValue
      ) {
        addIssue(context, rule);
      }
    }
  }
};

/**
 * Applies only stable, data-described refinements. The exact same rule data is retained for the
 * compiled authority, so changing a custom parser rule necessarily changes its fingerprint.
 */
export function withRniInputSchemaRefinements<T extends z.ZodTypeAny>(
  schema: T,
  rules: readonly RefinementRule[],
): z.ZodEffects<T> {
  const refined = schema.superRefine((value, context) => {
    for (const rule of rules) applyRule(value, rule, context);
  });
  refinementRules.set(refined, rules);
  return refined;
}

const undefinedValue = { type: 'undefined' } as const;

const plainAuthority = (value: unknown): RniInputSchemaAuthorityValue => {
  if (value === undefined) return undefinedValue;
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }
  if (value instanceof RegExp) {
    return { type: 'regular_expression', source: value.source, flags: value.flags };
  }
  if (Array.isArray(value)) return value.map(plainAuthority);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, plainAuthority(child)]),
    );
  }
  throw new Error('Unsupported value in an RNI input-schema authority');
};

const lengthAuthority = (value: unknown): RniInputSchemaAuthorityValue =>
  value === null ? null : plainAuthority(value);

/** Deterministic semantic description of the Zod constructs used by governed prompt inputs. */
export function compileRniInputSchemaAuthority(
  schema: z.ZodTypeAny,
): Readonly<Record<string, RniInputSchemaAuthorityValue>> {
  const visit = (current: z.ZodTypeAny): Readonly<Record<string, RniInputSchemaAuthorityValue>> => {
    const definition = current._def as Record<string, unknown>;
    const typeName = definition['typeName'];
    if (typeof typeName !== 'string') throw new Error('RNI input schema has no Zod type name');

    switch (typeName) {
      case z.ZodFirstPartyTypeKind.ZodString:
      case z.ZodFirstPartyTypeKind.ZodNumber:
        return {
          type: typeName,
          checks: plainAuthority(definition['checks']) as RniInputSchemaAuthorityValue,
          coerce: Boolean(definition['coerce']),
        };
      case z.ZodFirstPartyTypeKind.ZodBoolean:
        return { type: typeName, coerce: Boolean(definition['coerce']) };
      case z.ZodFirstPartyTypeKind.ZodLiteral:
        return { type: typeName, value: plainAuthority(definition['value']) };
      case z.ZodFirstPartyTypeKind.ZodEnum:
        return { type: typeName, values: plainAuthority(definition['values']) };
      case z.ZodFirstPartyTypeKind.ZodArray:
        return {
          type: typeName,
          item: visit(definition['type'] as z.ZodTypeAny),
          exactLength: lengthAuthority(definition['exactLength']),
          minimumLength: lengthAuthority(definition['minLength']),
          maximumLength: lengthAuthority(definition['maxLength']),
        };
      case z.ZodFirstPartyTypeKind.ZodObject: {
        const shape = (definition['shape'] as () => Record<string, z.ZodTypeAny>)();
        return {
          type: typeName,
          unknownKeys: String(definition['unknownKeys']),
          catchall: visit(definition['catchall'] as z.ZodTypeAny),
          shape: Object.fromEntries(
            Object.entries(shape)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, child]) => [key, visit(child)]),
          ),
        };
      }
      case z.ZodFirstPartyTypeKind.ZodTuple:
        return {
          type: typeName,
          items: (definition['items'] as z.ZodTypeAny[]).map(visit),
          rest: definition['rest'] === null ? null : visit(definition['rest'] as z.ZodTypeAny),
        };
      case z.ZodFirstPartyTypeKind.ZodNullable:
      case z.ZodFirstPartyTypeKind.ZodOptional:
        return { type: typeName, inner: visit(definition['innerType'] as z.ZodTypeAny) };
      case z.ZodFirstPartyTypeKind.ZodRecord:
        return {
          type: typeName,
          key: visit(definition['keyType'] as z.ZodTypeAny),
          value: visit(definition['valueType'] as z.ZodTypeAny),
        };
      case z.ZodFirstPartyTypeKind.ZodUnknown:
      case z.ZodFirstPartyTypeKind.ZodNever:
        return { type: typeName };
      case z.ZodFirstPartyTypeKind.ZodEffects: {
        const rules = refinementRules.get(current);
        if (rules === undefined) {
          throw new Error('RNI input schema contains an unregistered custom effect');
        }
        return {
          type: typeName,
          effect: 'stable_refinement_rules',
          rules: plainAuthority(rules),
          inner: visit(definition['schema'] as z.ZodTypeAny),
        };
      }
      default:
        throw new Error(`Unsupported Zod type in RNI input-schema authority: ${typeName}`);
    }
  };

  return visit(schema);
}
