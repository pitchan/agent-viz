'use strict';
// Idempotent schema migrations for an existing observatory.db.
// CREATE TABLE IF NOT EXISTS never adds a column to an existing table, and
// dropping the database would lose recommendation statuses — the only data a
// re-scan cannot rebuild. One entry per evolution: a table, not branches.

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

const MIGRATIONS = [
  { table: 'sessions', column: 'session_kind', ddl: 'session_kind TEXT' },
  { table: 'recommendations', column: 'period_from', ddl: 'period_from TEXT' },
  { table: 'recommendations', column: 'period_to', ddl: 'period_to TEXT' },
];

function applyMigrations(db) {
  for (const m of MIGRATIONS) {
    if (!columnNames(db, m.table).includes(m.column)) {
      db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.ddl}`);
    }
  }
}

module.exports = { applyMigrations };
