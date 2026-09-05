module.exports = {
  friendlyName: 'Ensure team membership schema',
  inputs: {},
  fn: async function () {
    const db = sails.getDatastore()
    await db.sendNativeQuery(`CREATE TABLE IF NOT EXISTS team_memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL, team_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'active', created_at INTEGER, updated_at INTEGER
    )`)
    const columns = await db.sendNativeQuery('PRAGMA table_info(cli_tokens)')
    if (!(columns.rows || []).some((column) => column.name === 'team_id'))
      await db.sendNativeQuery(
        'ALTER TABLE cli_tokens ADD COLUMN team_id INTEGER'
      )
    // One-time migration; rerunning must not resurrect a removed membership.
    if (!(await Setting.findOne({ key: 'teamMembershipMigration' }))) {
      await require('../../lib/with-datastore-transaction')(
        async (connection) => {
          await db.sendNativeQuery(`INSERT OR IGNORE INTO team_memberships (key, user_id, team_id, role, status, created_at, updated_at)
          SELECT CAST(id AS TEXT) || ':' || CAST(team AS TEXT), id, team, COALESCE(NULLIF(team_role, ''), 'member'), 'active', ${Date.now()}, ${Date.now()} FROM users WHERE team IS NOT NULL`)
          await db.sendNativeQuery(`INSERT OR REPLACE INTO team_memberships (key, user_id, team_id, role, status, created_at, updated_at)
          SELECT CAST(owner AS TEXT) || ':' || CAST(id AS TEXT), owner, id, 'owner', 'active', ${Date.now()}, ${Date.now()} FROM teams`)
          await db.sendNativeQuery(
            'UPDATE cli_tokens SET team_id = (SELECT team FROM users WHERE users.id = cli_tokens.user) WHERE team_id IS NULL'
          )
          await Setting.create({
            key: 'teamMembershipMigration',
            value: '1'
          }).usingConnection(connection)
        }
      )
    }
  }
}
