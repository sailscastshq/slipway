module.exports = {
  friendlyName: 'Ensure Helm workspace schema',

  description:
    'Create durable Helm history and snippet tables on existing production databases.',

  inputs: {},

  fn: async function () {
    const datastore = sails.getDatastore()

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS helm_history_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'error',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        executed_at INTEGER NOT NULL,
        target TEXT NOT NULL,
        target_context TEXT,
        pinned BOOLEAN NOT NULL DEFAULT 0,
        user INTEGER NOT NULL,
        team INTEGER NOT NULL,
        project INTEGER NOT NULL,
        environment INTEGER NOT NULL,
        app INTEGER NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    const historyColumnsResult = await datastore.sendNativeQuery(
      'PRAGMA table_info(helm_history_entries)'
    )
    const historyColumns = new Set(
      (historyColumnsResult.rows || historyColumnsResult || []).map(
        (column) => column.name
      )
    )
    if (!historyColumns.has('target_context')) {
      await datastore.sendNativeQuery(
        'ALTER TABLE helm_history_entries ADD COLUMN target_context TEXT'
      )
    }

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS helm_history_scope
      ON helm_history_entries (
        user,
        project,
        environment,
        pinned,
        executed_at DESC
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS helm_history_retention
      ON helm_history_entries (pinned, executed_at, id)
    `)

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS helm_snippets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        source TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'personal',
        owner INTEGER NOT NULL,
        team INTEGER NOT NULL,
        project INTEGER NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS helm_snippets_personal_name
      ON helm_snippets (project, owner, lower(name))
      WHERE scope = 'personal'
    `)

    await datastore.sendNativeQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS helm_snippets_project_name
      ON helm_snippets (project, lower(name))
      WHERE scope = 'project'
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS helm_snippets_visible
      ON helm_snippets (project, scope, owner, updated_at DESC)
    `)

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS helm_write_arms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        source_hash TEXT NOT NULL,
        target_fingerprint TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        user INTEGER NOT NULL,
        team INTEGER NOT NULL,
        project INTEGER NOT NULL,
        environment INTEGER NOT NULL,
        app INTEGER NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS helm_write_arms_lookup
      ON helm_write_arms (
        token_hash,
        source_hash,
        target_fingerprint,
        expires_at,
        used_at
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS helm_write_arms_retention
      ON helm_write_arms (expires_at, used_at)
    `)
  }
}
