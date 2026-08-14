'use strict';
// Idempotent schema migrations for an existing observatory.db.
// CREATE TABLE IF NOT EXISTS never adds a column to an existing table, and
// dropping the database would lose recommendation statuses — the only data a
// re-scan cannot rebuild. One entry per evolution: a table, not branches.

// node:sqlite ships no type declarations yet (TS2307) — store.ts (lot 6) owns
// that boundary. This file only needs the two calls it actually makes, kept
// minimal so it does not assume more of `db` than that.
interface SqliteDb {
  prepare(sql: string): { all(): unknown[] };
  exec(sql: string): void;
}

// PRAGMA table_info rows are `unknown` at the type level (the query result of
// an untyped driver) — narrowed here rather than assumed, per the plan's rule
// for anything SQLite hands back.
function isColumnInfo(row: unknown): row is { name: string } {
  return typeof row === 'object' && row !== null && typeof (row as Record<string, unknown>).name === 'string';
}

function columnNames(db: SqliteDb, table: string): string[] {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .filter(isColumnInfo)
    .map(c => c.name);
}

interface Migration {
  table: string;
  column: string;
  ddl: string;
}

const MIGRATIONS: Migration[] = [
  { table: 'sessions', column: 'session_kind', ddl: 'session_kind TEXT' },
  { table: 'recommendations', column: 'period_from', ddl: 'period_from TEXT' },
  { table: 'recommendations', column: 'period_to', ddl: 'period_to TEXT' },
];

function applyMigrations(db: SqliteDb): void {
  for (const m of MIGRATIONS) {
    if (!columnNames(db, m.table).includes(m.column)) {
      db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.ddl}`);
    }
  }
}

export { applyMigrations };
