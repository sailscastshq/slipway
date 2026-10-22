const fs = require('node:fs')
const path = require('node:path')
const { AsyncLocalStorage } = require('node:async_hooks')
const Database = require('better-sqlite3')
const migrations = require('./release-migrations')
const scopes = new AsyncLocalStorage()

function policy(sails) {
  return [
    sails.config?.environment,
    process.env.NODE_ENV,
    process.env.SLIPWAY_RELEASE_SCHEMA_REQUIRED
  ]
}
function required(sails) {
  return (
    sails.config?.environment === 'production' ||
    process.env.NODE_ENV === 'production' ||
    process.env.SLIPWAY_RELEASE_SCHEMA_REQUIRED === '1'
  )
}
function service(sails, datastore) {
  const configured = sails.config?.datastores?.[datastore]
  if (configured?.adapter !== 'sails-sqlite' || !configured.url)
    throw Error(
      `Slipway ${datastore} release schema is not ready; start through node app.js before using production helpers.`
    )
  return { type: 'sqlite', datastore, path: path.resolve(configured.url) }
}
function identity(sails, datastore) {
  const target = service(sails, datastore)
  const configured = sails.config.datastores[datastore]
  const real = fs.realpathSync(target.path)
  const stat = fs.statSync(real, { bigint: true })
  return {
    target,
    key: JSON.stringify([
      configured.adapter,
      configured.url,
      real,
      String(stat.dev),
      String(stat.ino)
    ])
  }
}
function unchanged(state) {
  if (JSON.stringify(policy(state.sails)) !== state.policy)
    throw Error('Release schema policy changed during verification scope.')
  for (const [name, entry] of state.entries) {
    if (
      identity(state.sails, name).key !== entry.key ||
      !entry.database.open ||
      entry.database.inTransaction
    )
      throw Error(
        `Slipway ${name} database identity or connection changed during verification scope.`
      )
  }
}

// This scope reuses handles, never verification results. No transaction or
// iterator is retained across awaits; the original cross-database TOCTOU remains.
function releaseSchemaReady(sails) {
  const state = scopes.getStore()
  if (state) {
    try {
      if (state.closed)
        throw Error('Release schema verification scope is closed.')
      if (state.error) throw state.error
      if (state.sails !== sails)
        throw Error(
          'Release schema verification scope belongs to another Sails instance.'
        )
      unchanged(state)
      for (const entry of state.entries.values())
        if (!migrations.current(entry.target, { database: entry.database }))
          throw Error(
            `Slipway ${entry.target.datastore} release schema is not ready; start through node app.js before using production helpers.`
          )
      unchanged(state)
      return true
    } catch (error) {
      state.error ||= error
      throw state.error
    }
  }
  if (!required(sails)) return false
  for (const datastore of Object.keys(migrations.files))
    if (!migrations.current(service(sails, datastore)))
      throw Error(
        `Slipway ${datastore} release schema is not ready; start through node app.js before using production helpers.`
      )
  return true
}

releaseSchemaReady.withScope = async function (sails, callback) {
  const existing = scopes.getStore()
  if (existing) {
    const error = Error('Release schema verification scopes cannot be nested.')
    existing.error ||= error
    throw existing.error
  }
  if (!required(sails)) return callback()
  const state = {
    sails,
    policy: JSON.stringify(policy(sails)),
    entries: new Map(),
    error: null,
    closed: false
  }
  return await scopes.run(state, async () => {
    let result
    try {
      for (const name of Object.keys(migrations.files)) {
        const entry = identity(sails, name)
        entry.database = new Database(entry.target.path, {
          readonly: true,
          fileMustExist: true
        })
        state.entries.set(name, entry)
        unchanged(state)
      }
      result = await callback()
      if (!state.error) unchanged(state)
    } catch (error) {
      state.error ||= error
    } finally {
      // ALS descendants may outlive callback completion. Revoke before closing.
      state.closed = true
      for (const entry of state.entries.values()) {
        try {
          entry.database.close()
        } catch (error) {
          state.error ||= error
        }
      }
    }
    if (state.error) throw state.error
    return result
  })
}

module.exports = releaseSchemaReady
