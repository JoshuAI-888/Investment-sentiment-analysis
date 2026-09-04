/**
 * Row mapping. Postgres columns are `snake_case`; domain objects are `camelCase`.
 *
 * Done generically rather than with a hand-written mapper per table, because 34 hand-written
 * mappers is 34 chances to transpose two fields — and a transposition between two columns of
 * the same type is invisible to the type checker and to review.
 */
export type Row = Record<string, unknown>;

export function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

export function toSnake(key: string): string {
  return key.replace(/([A-Z])/g, (_, char: string) => `_${char.toLowerCase()}`);
}

export function camelizeRow(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) out[toCamel(key)] = value;
  return out;
}

export function snakeizeRow(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) out[toSnake(key)] = value;
  return out;
}

/** `insert into t (a, b) values ($1, $2)` — column list and placeholders from one object. */
export function insertClause(row: Row): {
  columns: string;
  placeholders: string;
  values: unknown[];
} {
  const entries = Object.entries(snakeizeRow(row)).filter(([, value]) => value !== undefined);
  return {
    columns: entries.map(([key]) => `"${key}"`).join(', '),
    placeholders: entries.map((_, index) => `$${index + 1}`).join(', '),
    values: entries.map(([, value]) => value),
  };
}
