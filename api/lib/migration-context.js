const fs = require('node:fs')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { digest, failure } = require('./migration-plans')
const exec = promisify(execFile)

function target(service, scope) {
  const physicalKey =
    service.type === 'sqlite'
      ? `sqlite:${fs.realpathSync(service.path)}`
      : `${service.type}:${service.containerName}:${service.database}`
  return {
    ...scope,
    dialect: service.type,
    key:
      scope.kind === 'bosun'
        ? `bosun:${scope.database}`
        : `dock:${scope.serviceId}`,
    physicalKey
  }
}

async function source(service, app) {
  const result = {
    database: {
      type: service.type,
      containerName: service.containerName,
      database: service.database,
      username: service.username,
      credentialHash: digest(service.password || null)
    },
    appId: app?.id
  }
  for (const [key, name] of [
    ['databaseContainer', service.containerName],
    ['appContainer', app?.containerName]
  ]) {
    if (!name) continue
    const record = JSON.parse(
      (
        await exec(
          sails.config.docker?.binaryPath || 'docker',
          ['inspect', name],
          { timeout: 5000, maxBuffer: 1024 * 1024 }
        )
      ).stdout
    )[0]
    result[key] = {
      id: record.Id,
      image: record.Image,
      configHash: digest({
        env: record.Config.Env,
        directory: record.Config.WorkingDir,
        mounts: record.Mounts
      })
    }
  }
  return result
}

async function refresh(scope) {
  if (scope.kind === 'bosun') {
    const service = await sails.helpers.bosun.getDatabaseService(scope.database)
    const models = await sails.helpers.bosun.getModels(scope.database)
    return {
      service,
      models: models.models,
      source: await source(service),
      target: target(service, { kind: 'bosun', database: scope.database })
    }
  }
  const { service } = await sails.helpers.dock.getDatabaseService(
    scope.environmentId,
    scope.serviceId
  )
  const app = await App.findOne({
    id: scope.appId,
    environment: scope.environmentId
  })
  if (!app?.containerName)
    throw failure('The deployed app changed. Refresh the migration preview.')
  const models = await sails.helpers.dock.getModels(app.containerName)
  if (!models.authoritative || models.error || models.formatVersion !== 1)
    throw failure(
      'The deployed model snapshot is unavailable. Refresh before migrating.'
    )
  const plainScope = {
    kind: 'dock',
    projectId: scope.projectId,
    environmentId: scope.environmentId,
    serviceId: service.id,
    appId: app.id
  }
  return {
    service,
    models: models.models,
    source: await source(service, app),
    target: target(service, plainScope)
  }
}

async function refreshVersion(scope) {
  if (scope.kind === 'bosun')
    return source(await sails.helpers.bosun.getDatabaseService(scope.database))
  const { service } = await sails.helpers.dock.getDatabaseService(
    scope.environmentId,
    scope.serviceId
  )
  const app = await App.findOne({
    id: scope.appId,
    environment: scope.environmentId
  })
  if (!app) throw failure('The deployed app changed during migration.')
  return source(service, app)
}

module.exports = { target, source, refresh, refreshVersion }
