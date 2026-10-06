module.exports = {
  friendlyName: 'Ensure runtime configuration schema',

  description:
    'Add deployment-native configuration metadata and encrypted app storage to existing installations.',

  inputs: {},

  fn: async function () {
    if (require('../../lib/upgrade-business-bootstrap').coordinated()) {
      return require('../../lib/upgrade-business-bootstrap').configuration()
    }
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

    await require('../../lib/upgrade-business-bootstrap').configuration()
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
