const recovery = require('./deployment-recovery')
const INTENT_PREFIX = 'rollbackIntent:v1:'

// Only metadata owned by this exact deletion scope can transition into its
// durable snapshot. Unexplained orphan records and operator holds stay closed.
async function capture({ apps, appIds, deploymentIds, db }) {
  const owners = new Map(apps.map((app) => [recovery.id(app.id), app]))
  const keys = [
    ...appIds.flatMap((appId) => [
      recovery.key(appId),
      recovery.HOLD_PREFIX + recovery.id(appId)
    ]),
    ...deploymentIds.map(
      (deploymentId) => INTENT_PREFIX + recovery.id(deploymentId)
    )
  ]
  if (!keys.length) return { settingKeys: [], imageIds: [] }
  let query = Setting.find({ key: { in: keys } })
  if (db) query = query.usingConnection(db)
  const rows = await query
  const images = new Set()
  for (const row of rows) {
    if (row.key.startsWith(recovery.HOLD_PREFIX))
      throw new Error(
        'Traffic recovery requires operator inspection before resource deletion.'
      )
    if (row.key.startsWith(recovery.PREFIX)) {
      const state = recovery.parse(row.value)
      const app = owners.get(state.appId)
      if (
        !app ||
        row.key !== recovery.key(app.id) ||
        state.environmentId !== recovery.id(app.environment) ||
        state.current.deploymentId !== recovery.id(app.currentDeployment) ||
        state.current.imageId !== app.imageId
      )
        throw new Error(
          'Deletion recovery metadata does not match its app owner.'
        )
      images.add(state.current.imageId)
      if (state.previous) images.add(state.previous.imageId)
    } else {
      const intent = JSON.parse(row.value)
      const app = owners.get(recovery.id(intent.appId))
      if (
        !app ||
        recovery.id(intent.environmentId) !== recovery.id(app.environment) ||
        !recovery.IMAGE_ID.test(intent.imageId || '')
      )
        throw new Error(
          'Deletion rollback intent does not match its app owner.'
        )
      images.add(intent.imageId)
    }
  }
  return {
    settingKeys: rows.map((row) => row.key).sort(),
    imageIds: [...images].sort()
  }
}

module.exports = { capture }
