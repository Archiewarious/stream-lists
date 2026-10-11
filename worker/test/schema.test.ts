// The CHECK constraints in migrations/ and the Worker's own lists of allowed values must agree: a value only one of
// them knows becomes a 500 from D1 instead of a 400.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ITEM_STATUSES, LIST_KINDS, TMDB_TYPES } from '../src/config';

const migrations = new URL('../migrations/', import.meta.url);
const sql = readdirSync(migrations)
  .sort()
  .map((file) => readFileSync(new URL(file, migrations), 'utf8'))
  .join('\n');
const allowed = (table: string, column: string) => {
  const statement = sql.split(';').find((part) => new RegExp(`(CREATE TABLE ${table}|ALTER TABLE ${table} ADD COLUMN ${column})\\b`).test(part) && part.includes(`${column} IN (`));
  const values = statement?.match(new RegExp(`${column} IN \\(([^)]*)\\)`))?.[1];
  return values?.split(',').map((value) => value.trim().replace(/'/g, ''));
};

describe('schema', () => {
  it('allows the same values as the Worker', () => {
    expect(allowed('lists', 'kind')).toEqual(LIST_KINDS);
    expect(allowed('items', 'status')).toEqual(ITEM_STATUSES);
    expect(allowed('items', 'tmdb_type')).toEqual(TMDB_TYPES);
  });
});
