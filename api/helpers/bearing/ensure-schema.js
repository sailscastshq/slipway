module.exports = {
  friendlyName: 'Ensure Bearing schema',

  description:
    'Create app-owned Bearing tables and storage metadata on existing production databases.',

  inputs: {},

  fn: async function () {
    const datastore = sails.getDatastore()

    await addColumns(datastore, 'apps', [
      ['bearing_enabled', 'BOOLEAN NOT NULL DEFAULT 0'],
      ['bearing_secret', 'TEXT']
    ])

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS bearing_spaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_slug TEXT NOT NULL UNIQUE,
        accept_feedback BOOLEAN NOT NULL DEFAULT 1,
        allow_anonymous_participation BOOLEAN NOT NULL DEFAULT 0,
        feedback_categories TEXT NOT NULL DEFAULT '[]',
        show_public_roadmap BOOLEAN NOT NULL DEFAULT 1,
        show_public_updates BOOLEAN NOT NULL DEFAULT 1,
        widget_enabled BOOLEAN NOT NULL DEFAULT 0,
        widget_side TEXT NOT NULL DEFAULT 'right',
        widget_opening_view TEXT NOT NULL DEFAULT 'updates',
        show_unread BOOLEAN NOT NULL DEFAULT 1,
        app INTEGER NOT NULL UNIQUE,
        created_by INTEGER NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS bearing_participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        participant_key TEXT NOT NULL UNIQUE,
        host_user_id TEXT NOT NULL,
        display_name TEXT,
        email TEXT NOT NULL,
        email_verified_at INTEGER NOT NULL,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        disabled_at INTEGER,
        space INTEGER NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS bearing_participants_space_activity
      ON bearing_participants (space, last_seen_at)
    `)

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS bearing_launch_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        participant INTEGER NOT NULL,
        app INTEGER NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS bearing_launch_codes_expiry
      ON bearing_launch_codes (expires_at, used_at)
    `)

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS bearing_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        details TEXT,
        images TEXT NOT NULL DEFAULT '[]',
        category TEXT NOT NULL DEFAULT 'feature',
        status TEXT NOT NULL DEFAULT 'reviewing',
        vote_count INTEGER NOT NULL DEFAULT 0,
        submitted_anonymously BOOLEAN NOT NULL DEFAULT 0,
        author INTEGER,
        space INTEGER NOT NULL,
        app INTEGER NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    await addColumns(datastore, 'bearing_feedback', [
      ['images', "TEXT NOT NULL DEFAULT '[]'"]
    ])

    await datastore.sendNativeQuery(`
      UPDATE bearing_feedback
      SET status = 'reviewing'
      WHERE status = 'open'
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS bearing_feedback_space_rank
      ON bearing_feedback (space, vote_count, created_at)
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS bearing_feedback_space_status
      ON bearing_feedback (space, status, created_at)
    `)

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS bearing_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        voter_key TEXT NOT NULL UNIQUE,
        participant INTEGER,
        feedback INTEGER NOT NULL,
        space INTEGER NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS bearing_votes_feedback
      ON bearing_votes (feedback, created_at)
    `)

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS bearing_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        slug TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        published_at INTEGER,
        author INTEGER NOT NULL,
        space INTEGER NOT NULL,
        app INTEGER NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    await addColumns(datastore, 'bearing_updates', [['slug', 'TEXT']])

    await datastore.sendNativeQuery(`
      UPDATE bearing_updates
      SET slug = replace(lower(public_id), '_', '-')
      WHERE slug IS NULL OR slug = ''
    `)

    await datastore.sendNativeQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS bearing_updates_space_slug
      ON bearing_updates (space, slug)
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS bearing_updates_space_status
      ON bearing_updates (space, status, published_at)
    `)

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS bearing_update_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        link_key TEXT NOT NULL UNIQUE,
        bearing_update INTEGER NOT NULL,
        feedback INTEGER NOT NULL,
        space INTEGER NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE INDEX IF NOT EXISTS bearing_update_links_update
      ON bearing_update_links (bearing_update, feedback)
    `)
  }
}

async function addColumns(datastore, table, columns) {
  const result = await datastore.sendNativeQuery(`PRAGMA table_info(${table})`)
  const existing = new Set(rows(result).map((column) => column.name))

  for (const [name, definition] of columns) {
    if (existing.has(name)) continue
    await datastore.sendNativeQuery(
      `ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`
    )
  }
}

function rows(result) {
  return result.rows || result || []
}
