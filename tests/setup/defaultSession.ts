import { beforeAll, afterAll } from 'vitest'
import { openDatabaseAt, __setDefaultSessionForTesting } from '../../src/core/db/sqlite.js'

/**
 * Points `getActiveSession()`'s default-session fallback at an in-memory DB
 * for every test file, so code paths that call `getActiveSession()` without
 * an explicit session override (e.g. HTTP routes with no repoId, the LSP
 * server) never create a real `.gitsema/index.db` in the repo root cwd.
 */
beforeAll(() => {
  __setDefaultSessionForTesting(openDatabaseAt(':memory:'))
})

afterAll(() => {
  __setDefaultSessionForTesting(undefined)
})
