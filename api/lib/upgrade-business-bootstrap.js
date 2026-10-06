// Business backfills and readiness retained after native schema coordination.
// No catalog mutation belongs in these functions. Legacy helpers also use them.
async function team() {
  const db = sails.getDatastore()
  // One-time migration; rerunning must not resurrect a removed membership.
  if (!(await Setting.findOne({ key: 'teamMembershipMigration' }))) {
    await require('./with-datastore-transaction')(async (connection) => {
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
    })
  }
}
async function configuration() {
  const apps = await App.find().decrypt()
  for (const app of apps) {
    if (app.secureEnvVars !== null && app.secureEnvVars !== undefined) {
      continue
    }
    const legacyValues = app.envVars || {}
    if (Object.keys(legacyValues).length === 0) continue

    await App.updateOne({ id: app.id }).set({
      secureEnvVars: legacyValues,
      envVars: {}
    })
  }
}
async function service() {
  await Service.update({
    type: 'custom',
    status: { in: ['creating', 'changing'] }
  }).set({ status: 'failed' })
}
async function bearingFeedback() {
  await sails
    .getDatastore()
    .sendNativeQuery(
      `UPDATE bearing_feedback SET status='reviewing' WHERE status='open'`
    )
}
async function bearingUpdates() {
  await sails
    .getDatastore()
    .sendNativeQuery(
      `UPDATE bearing_updates SET slug=replace(lower(public_id), '_', '-') WHERE slug IS NULL OR slug=''`
    )
}
async function bearing() {
  await bearingFeedback()
  await bearingUpdates()
}
async function cleanup() {
  await sails.getDatastore().sendNativeQuery(`
    UPDATE cleanup_operations
    SET request_key = target_key
    WHERE request_key IS NULL
  `)
}
async function lookout() {
  const datastore = sails.getDatastore('observability')
  for (const table of [
    'telemetry_spans',
    'telemetry_exceptions',
    'telemetry_metrics'
  ]) {
    await datastore.sendNativeQuery(
      `UPDATE ${table} SET created_at=? WHERE created_at IS NULL OR created_at>?`,
      [Date.now(), Date.now()]
    )
  }
  return { ready: true }
}
async function wake() {
  sails.wakeStorageReady = false
  if (sails.wakeStorageFallback)
    throw Error('Wake persistent storage is unavailable')
  const db = sails.getDatastore('analytics')
  db.manager.pragma('synchronous=FULL')
  db.manager.pragma('busy_timeout=100')
  db.manager.pragma('cache_size=-65536')
  // Native receipt admission established the complete catalog before ORM.
  sails.wakeStorageReady = true
}
async function bootstrap() {
  await team()
  await cleanup()
  await bearing()
  try {
    await wake()
  } catch {
    sails.log.warn(
      'Wake analytics storage is unavailable; collection is disabled.'
    )
  }
  await configuration()
  await service()
}
function coordinated() {
  const ready = require('./upgrade-startup').fromEnvironment(
    sails.config?.datastores
  )
  if (ready && !sails.config?.datastores) {
    throw Object.assign(
      new Error(
        'Coordinated business startup requires actual datastore configuration.'
      ),
      { code: 'upgradeNotReady' }
    )
  }
  return ready
}
module.exports = {
  coordinated,
  bootstrap,
  team,
  configuration,
  service,
  bearing,
  bearingFeedback,
  bearingUpdates,
  cleanup,
  lookout,
  wake
}
