module.exports = {
  friendlyName: 'Ensure team membership schema',
  inputs: {},
  fn: async function () {
    if (require('../../lib/upgrade-business-bootstrap').coordinated()) {
      return require('../../lib/upgrade-business-bootstrap').team()
    }
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
    await require('../../lib/upgrade-business-bootstrap').team()
  }
}
