const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const runtime = require('../../api/lib/quest-runtime-client')
const workspace = require('../../api/lib/quest-workspace')
const {
  createQuestRuntime,
  describeJob
} = require('../../packages/hook/lib/quest-runtime')

const worldFor = (slug) => ({
  name: 'configured-slipway',
  context: { deploymentTarget: { slug } }
})

// Stub the entire container transport before opening a page. The adapter below
// emits synthetic contract events only: no Docker, shell, real job or scheduler.
async function residentFixture({ sails, world }, slug) {
  const current = world.current
  const environment = current.environments.production
  const deployment = await world.create('deployment').with({
    environment: environment.id,
    app: current.apps.web.id,
    status: 'running'
  })
  const app = await sails.models.app
    .updateOne({ id: current.apps.web.id })
    .set({
      status: 'running',
      containerName: 'synthetic-container-never-executed',
      currentDeployment: deployment.id
    })
  await sails.models.environment.updateOne({ id: environment.id }).set({
    features: { 'sails-quest': { scripts: [{ name: 'synthetic-report' }] } }
  })
  const emitter = new EventEmitter()
  const job = {
    name: 'synthetic-report',
    script: 'scripts/synthetic-report.js',
    inputMetadataAvailable: true,
    inputs: {
      enabled: { type: 'boolean' },
      count: { type: 'number', min: 0, max: 10 },
      label: { type: 'string', maxLength: 40 },
      payload: { type: 'json' }
    },
    schedule: { interval: 60000 },
    paused: false,
    withoutOverlapping: true,
    runningCount: 0
  }
  const info = {
    contractVersion: 1,
    runtimeId: 'synthetic-runtime',
    capabilities: {
      residentState: true,
      childSchedulerSuppression: true,
      runIdentity: true,
      inputMetadata: true,
      businessResults: true
    }
  }
  const calls = [],
    starts = []
  let contractVersion = 1
  emitter.quest = {
    getRuntime: () => ({ ...info, contractVersion }),
    metadata: () => [job],
    pause: () => {
      job.paused = true
    },
    resume: () => {
      job.paused = false
    },
    run(name, inputs) {
      const runId = crypto.randomUUID()
      starts.push({ name, inputs, runId })
      emitter.emit('quest:job:start', {
        name,
        inputs,
        runId,
        runtimeId: info.runtimeId,
        sequence: 1,
        startedAt: Date.now()
      })
      return Promise.resolve({ deliberatelyNotTerminalEvidence: true })
    }
  }
  const bridge = createQuestRuntime({
    sails: emitter,
    appId: String(app.id),
    deploymentId: String(deployment.id)
  })
  emitter.on('quest:job:start', (event) => bridge.record('running', event))
  const original = runtime.request
  runtime.request = async (target, command, values = {}) => {
    calls.push({ target, command, values })
    assert.equal(target.id, app.id)
    assert.equal(target.containerName, 'synthetic-container-never-executed')
    return bridge.dispatch({
      ...values,
      command,
      appId: String(target.id),
      deploymentId: String(target.currentDeployment)
    })
  }
  workspace.invalidate(app)
  return {
    app,
    job,
    info,
    starts,
    calls,
    bridge,
    page: `/projects/${slug}/quest`,
    base: `/api/v1/projects/${slug}/quest`,
    body: (extra = {}) => ({
      runtimeId: info.runtimeId,
      metadataVersion: describeJob(job).metadataVersion,
      requestId: crypto.randomUUID(),
      jobInputs: {},
      productionConfirmed: true,
      ...extra
    }),
    setContract: (version) => {
      contractVersion = version
      workspace.invalidate(app)
    },
    restore: () => {
      runtime.request = original
      workspace.invalidate(app)
    }
  }
}
async function bearerRequest({ sails, request }, user) {
  const token = crypto.randomBytes(24).toString('hex')
  await sails.models.clitoken.create({
    user: user.id,
    token: crypto.createHash('sha256').update(token).digest('hex')
  })
  return request.withHeaders({
    authorization: `Bearer sl_${token}`,
    accept: 'application/json'
  })
}

module.exports = { worldFor, residentFixture, bearerRequest }
