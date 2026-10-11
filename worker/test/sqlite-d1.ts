// The part of the D1 API the Worker uses, over Node's built-in SQLite (in memory). D1 is SQLite too; like D1 this
// checks foreign keys and runs a batch as one transaction. Every call is async, so concurrent requests interleave
// at the same points as on D1.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export const sqliteD1 = (): D1Database => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');

  const statement = (sql: string, params: SQLInputValue[] = []) => {
    const rows = () => db.prepare(sql).all(...params).map((row) => ({ ...row }));
    const meta = () => ({ changes: Number(db.prepare('SELECT changes() AS n').get()!.n) });
    const self = {
      bind: (...values: SQLInputValue[]) => statement(sql, values),
      first: async (column?: string) => {
        const [row] = rows();
        if (!row) return null;
        return column === undefined ? row : row[column];
      },
      all: async () => ({ success: true, results: rows(), meta: meta() }),
      run: async () => {
        const result = db.prepare(sql).run(...params);
        return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
      // Synchronous variant for batch(): no other request may run in the middle of a transaction.
      allNow: () => ({ success: true, results: rows(), meta: meta() }),
    };
    return self;
  };

  return {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: ReturnType<typeof statement>[]) => {
      db.exec('BEGIN');
      try {
        const results = statements.map((item) => item.allNow());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
};
