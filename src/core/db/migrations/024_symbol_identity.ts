import Database from 'better-sqlite3'
import type { Migration } from './runner.js'

export const migration: Migration = {
  version: 24,
  description: 'Add path-free stable symbol identity columns (qualified_name, signature, signature_hash, parent_qualified_name) to symbols',
  up(sqlite: InstanceType<typeof Database>) {
    const cols = sqlite.prepare('PRAGMA table_info(symbols)').all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'qualified_name')) {
      sqlite.exec(`ALTER TABLE symbols ADD COLUMN qualified_name TEXT;`)
    }
    if (!cols.some((c) => c.name === 'signature')) {
      sqlite.exec(`ALTER TABLE symbols ADD COLUMN signature TEXT;`)
    }
    if (!cols.some((c) => c.name === 'signature_hash')) {
      sqlite.exec(`ALTER TABLE symbols ADD COLUMN signature_hash TEXT;`)
    }
    if (!cols.some((c) => c.name === 'parent_qualified_name')) {
      sqlite.exec(`ALTER TABLE symbols ADD COLUMN parent_qualified_name TEXT;`)
    }
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_symbols_qualified_name_sig
        ON symbols(qualified_name, signature_hash);
      CREATE INDEX IF NOT EXISTS idx_symbols_blob_hash_qualified_name
        ON symbols(blob_hash, qualified_name);
    `)
  },
}
