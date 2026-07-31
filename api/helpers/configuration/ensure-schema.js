module.exports = {
  friendlyName: 'Ensure runtime configuration schema',

  description:
    'Add deployment-native configuration metadata and encrypted app storage to existing installations.',

  inputs: {},

  fn: async function () {
    const datastore = sails.getDatastore()

    await addColumns(datastore, 'environments', [
      ['env_var_metadata', "TEXT NOT NULL DEFAULT '{}'"]
    ])
    await addColumns(datastore, 'apps', [
      ['secure_env_vars', 'TEXT'],
      ['env_var_metadata', "TEXT NOT NULL DEFAULT '{}'"]
    ])
    await addColumns(datastore, 'deployments', [
      ['config_hash', 'TEXT'],
      ['config_manifest', "TEXT NOT NULL DEFAULT '[]'"]
    ])

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
