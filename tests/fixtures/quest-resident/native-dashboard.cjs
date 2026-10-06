const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const dc = require('node:diagnostics_channel')
const {
  requireCI,
  dashboardOptions,
  residentData
} = require('./native-config.cjs')
requireCI() // Before requiring Sails, reading credentials or opening anything.
const filename = process.env.QUEST_NATIVE_CONTEXT
assert.equal(fs.statSync(filename).mode & 0o777, 0o600)
const context = JSON.parse(fs.readFileSync(filename, 'utf8'))
const nativeFixture = JSON.parse(fs.readFileSync(context.nativeConfig, 'utf8'))
Object.assign(process.env, nativeFixture.env, {
  SLIPWAY_TEST_NATIVE_CONFIG: context.nativeConfig
})
const probe = require('./native-web/lib/probe')
const sails = require('sails')
let client
let closing = false

dc.channel('http.server.response.finish').subscribe(({ request, response }) => {
  if (request.url !== '/api/v1/telemetry/ingest') return
  // Observe the actual parsed HTTP request and terminal response. Credentials
  // and headers are deliberately excluded; no transport is replaced.
  probe('telemetry:ingest', {
    generation: context.generation,
    status: response.statusCode,
    bytes: Number(request.headers['content-length']),
    body: request.body
  })
})

function saveContext() {
  fs.writeFileSync(filename, JSON.stringify(context), { mode: 0o600 })
}

async function initialize() {
  const options = dashboardOptions({ ...context, nativeFixture })
  await new Promise((resolve, reject) =>
    sails.lift(options, (error) => (error ? reject(error) : resolve()))
  )
  const address = sails.hooks.http.server.address()
  assert.equal(address.address, '127.0.0.1')
  assert.equal(sails.config.sounding.datastore.mode, 'inherit')
  assert.equal(sails.config.models.migrate, 'safe')
  for (const [name, config] of Object.entries(options.datastores))
    assert.equal(sails.getDatastore(name).config.url, config.url)
  const {
    createWorldEngine,
    loadWorldFiles,
    createRequestClient,
    getDefaultConfig
  } = require('sounding')
  // These real Sounding factories and request client are bound only after lift.
  const world = createWorldEngine({ sails })
  const soundingConfig = {
    ...getDefaultConfig(),
    ...sails.config.sounding,
    request: { transport: 'http' }
  }
  const request = createRequestClient({
    sails,
    world,
    getConfig: () => soundingConfig
  })
  if (context.generation === 'A') {
    await loadWorldFiles({
      sails,
      world,
      appPath: context.repo,
      config: soundingConfig
    })
    await world.use('configured-slipway', {
      deploymentTarget: { slug: context.slug }
    })
    const current = world.current
    const environment = current.environments.production
    const deployment = await world.create('deployment').with({
      id: crypto.randomInt(100000000, 2000000000),
      environment: environment.id,
      app: current.apps.web.id,
      status: 'running'
    })
    const app = await sails.models.app
      .updateOne({ id: current.apps.web.id })
      .set({
        status: 'running',
        currentDeployment: deployment.id,
        containerName: `native-resident-${context.slug}`
      })
    const telemetryToken = `stk_${crypto.randomBytes(24).toString('hex')}`
    await sails.models.environment.updateOne({ id: environment.id }).set({
      telemetryToken,
      telemetryTokenHash: crypto
        .createHash('sha256')
        .update(telemetryToken)
        .digest('hex'),
      features: {
        'sails-quest': { scripts: [{ name: 'rebuild-search-index' }] }
      }
    })
    const { bearerRequest } = require(path.join(
      context.repo,
      'tests/support/quest-resident-fixture'
    ))
    client = await bearerRequest(
      {
        sails,
        request: {
          withHeaders(headers) {
            context.authHeaders = headers
            return request.withHeaders(headers)
          }
        }
      },
      current.users.genesisUser
    )
    Object.assign(context, {
      appId: app.id,
      deploymentId: deployment.id,
      environmentId: environment.id,
      userId: current.users.genesisUser.id,
      port: address.port,
      telemetryToken,
      telemetryUrl: `http://127.0.0.1:${address.port}/api/v1/telemetry/ingest`
    })
    saveContext()
    assert.equal(
      await sails.models.questrun.count(),
      0,
      'No Quest receipt is seeded'
    )
  } else {
    assert.equal(address.port, context.port)
    client = request.withHeaders(context.authHeaders)
  }
  return {
    pid: process.pid,
    generation: context.generation,
    port: address.port,
    appId: context.appId,
    deploymentId: context.deploymentId,
    environmentId: context.environmentId
  }
}

async function dispatch(message) {
  const base = `/api/v1/projects/${context.slug}/quest`
  if (message.command === 'read') {
    assert.match(message.runId, /^[a-f0-9-]{36}$/)
    const response = await client.get(
      `${base}/runs/${message.runId}${message.logs ? '/logs' : ''}`
    )
    return { status: response.status, data: response.data }
  }
  if (message.command === 'recover') {
    // Explicit direct resident sub-proof. No substitute for the separately
    // tested Docker route, no replaced transport and no fabricated receipt.
    const { residentRequest } = require(path.join(
      context.repo,
      'api/lib/quest-runtime-client'
    ))
    const workspace = require(path.join(
      context.repo,
      'api/lib/quest-workspace'
    ))
    const app = await sails.models.app.findOne({ id: context.appId })
    const environment = await sails.models.environment.findOne({
      id: context.environmentId
    })
    const user = await sails.models.user.findOne({ id: context.userId })
    const { run } = residentData(
      await residentRequest({
        command: 'run',
        appId: String(app.id),
        deploymentId: String(app.currentDeployment),
        runtimeId: message.runtimeId,
        runId: message.runId
      })
    )
    assert.equal(run.runtimeId, message.runtimeId)
    assert.equal(run.runId, message.runId)
    await workspace.synchronizeRun({ app, environment, user }, run)
    return dispatch({ command: 'read', runId: run.runId })
  }
  if (message.command === 'budget') {
    const result = await sails
      .getDatastore('observability')
      .sendNativeQuery(
        'SELECT events, bytes, requests, rejected_events, rejected_requests FROM telemetry_ingestion_budgets WHERE environment=?',
        [String(context.environmentId)]
      )
    return { rows: result.rows, receipts: await sails.models.questrun.count() }
  }
  throw new Error('Unknown native dashboard command')
}

async function close() {
  if (closing) return
  closing = true
  await new Promise((resolve, reject) =>
    sails.lower((error) => (error ? reject(error) : resolve()))
  )
  process.exit(0)
}
process.on('SIGTERM', () => close().catch(() => process.exit(1)))
process.on('disconnect', () => close().catch(() => process.exit(1)))
let queue = Promise.resolve()
process.on('message', (message) => {
  queue = queue.then(async () => {
    try {
      process.send({ id: message.id, value: await dispatch(message) })
    } catch (error) {
      process.send({
        id: message.id,
        error: error.code || error.name || 'Native dashboard request failed'
      })
    }
  })
})
initialize()
  .then((ready) => process.send({ type: 'ready', ...ready }))
  .catch((error) => {
    // Errors may originate from config; never serialize the private context.
    console.error('Native dashboard lift failed:', error.code || error.name)
    process.exit(1)
  })
