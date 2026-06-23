import Database from 'better-sqlite3'
import { migration as m001 } from './001_file_type.js'
import { migration as m002 } from './002_blob_branches.js'
import { migration as m003 } from './003_query_embeddings.js'
import { migration as m004 } from './004_symbols.js'
import { migration as m005 } from './005_blob_clusters.js'
import { migration as m006 } from './006_commits_index.js'
import { migration as m007 } from './007_commit_embeddings.js'
import { migration as m008 } from './008_commits_author_cols.js'
import { migration as m009 } from './009_module_embeddings.js'
import { migration as m010 } from './010_rebuild_embeddings.js'
import { migration as m011 } from './011_quant_columns.js'
import { migration as m012 } from './012_indexes.js'
import { migration as m013 } from './013_embed_config.js'
import { migration as m014 } from './014_repos.js'
import { migration as m015 } from './015_repos_db_path.js'
import { migration as m016 } from './016_saved_queries.js'
import { migration as m017 } from './017_projections.js'
import { migration as m018 } from './018_embed_config_last_used.js'
import { migration as m019 } from './019_repo_tokens.js'
import { migration as m020 } from './020_paths_uniqueness.js'
import { migration as m021 } from './021_token_hashing.js'
import { migration as m022 } from './022_narrator_config.js'
import { migration as m023 } from './023_repos_persistent_storage.js'
import { migration as m024 } from './024_symbol_identity.js'
import { migration as m025 } from './025_structural_refs.js'
import { migration as m026 } from './026_graph_nodes_edges.js'
import { migration as m027 } from './027_auth_identity.js'
import { migration as m028 } from './028_orgs_grants.js'
import { migration as m029 } from './029_sso_identities.js'
import { migration as m030 } from './030_audit_log.js'
import { migration as m031 } from './031_repo_visibility.js'
import { migration as m032 } from './032_repo_profile.js'

export type Migration = {
  version: number
  description: string
  up: (sqlite: InstanceType<typeof Database>) => void
}

export const migrations: Migration[] = [
  m001,
  m002,
  m003,
  m004,
  m005,
  m006,
  m007,
  m008,
  m009,
  m010,
  m011,
  m012,
  m013,
  m014,
  m015,
  m016,
  m017,
  m018,
  m019,
  m020,
  m021,
  m022,
  m023,
  m024,
  m025,
  m026,
  m027,
  m028,
  m029,
  m030,
  m031,
  m032,
]

migrations.sort((a, b) => a.version - b.version)

export function runMigrations(sqlite: InstanceType<typeof Database>): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`)

  const row = sqlite.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined

  let version: number
  if (row === undefined) {
    const cols = sqlite.prepare(`PRAGMA table_info(embeddings)`).all() as Array<{ name: string }>
    version = cols.some((c) => c.name === 'file_type') ? 1 : 0
    sqlite.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`).run(String(version))
  } else {
    version = parseInt(row.value, 10)
  }

  for (const m of migrations) {
    if (m.version > version) {
      m.up(sqlite)
      version = m.version
      sqlite.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run(String(version))
    }
  }
}
