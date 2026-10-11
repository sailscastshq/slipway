const { test } = require('sounding')

test(
  'deployment log appends persist every concurrent chunk with occurrence times',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'persist-deployment-logs' }
      }
    }
  },
  async ({ sails, world, expect }) => {
    const current = world.current
    const deployment = await world.create('deployment').with({
      environment: current.environments.production.id,
      app: current.apps.web.id,
      buildLogs: 'Historical line\n'
    })

    await Promise.all([
      sails.models.deployment.appendBuildLog(deployment.id, 'First line\n'),
      sails.models.deployment.appendBuildLog(deployment.id, 'Second '),
      sails.models.deployment.appendBuildLog(deployment.id, 'line\n')
    ])

    const persisted = await sails.models.deployment.findOne({
      id: deployment.id
    })
    const lines = persisted.buildLogs.split('\n')
    expect(lines[0]).toBe('Historical line')
    expect(lines[1]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z First line$/
    )
    expect(lines[2]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z Second line$/
    )
  }
)

test(
  'deployment provenance survives persistence, API response, reload and streamed suffix offsets',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'deployment-provenance' } }
    }
  },
  async ({ sails, world, expect }) => {
    const assert = require('node:assert/strict')
    const events = require('../../../api/lib/deployment-log-events')
    const hook = sails.hooks.secrets
    const values = {
      APP_NAME: 'acaciaco',
      NODE_ENV: 'production',
      BASE_URL: 'https://acaciaco.example'
    }
    const metadata = sails.helpers.configuration.normalizeEnvVarMetadata(values)
    assert.equal(metadata.APP_NAME.kind, 'secret')
    assert.equal(metadata.NODE_ENV.redaction, 'unclassified')
    hook.remember({ envVars: values, envVarMetadata: metadata })
    const deployment = await world.create('deployment').with({
      status: 'building',
      environment: world.current.environments.production.id,
      app: world.current.apps.web.id
    })
    const name = `slipway-acaciaco-production-acaciaco-example-${deployment.id}`
    await Deployment.appendDeployLog(deployment.id, events.containerStart(name))
    let row = await Deployment.findOne(deployment.id)
    assert.match(row.deployLogs, /SlipwayDeploymentEvent/)
    const display = hook.renderDeploymentLog(row.deployLogs, deployment.id)
    assert.match(display, new RegExp(name))
    function response(value) {
      const res = { statusCode: 200, json: (value) => value, set() {} }
      hook.routes.before['/*'](
        { options: { action: 'api/v1/deployment/get-logs' } },
        res,
        () => {}
      )
      return res.json(value)
    }
    assert.equal(
      response({ deploymentId: deployment.id, deployLogs: row.deployLogs })
        .deployLogs,
      display
    )
    assert.equal(
      response({ props: { deployment: row } }).props.deployment.deployLogs,
      display
    )
    const sent = [],
      closes = []
    let resolveWait
    const stream = {
      send(value) {
        sent.push(response(value))
      },
      close() {
        closes.forEach((fn) => fn())
        resolveWait()
      },
      onClose(fn) {
        closes.push(fn)
      },
      wait() {
        return new Promise((resolve) => {
          resolveWait = resolve
        })
      }
    }
    const controller = require('../../../api/controllers/api/v1/deploy/stream-deployment')
    const pending = controller.fn.call(
      { req: {}, res: { sse: () => stream } },
      {
        id: String(deployment.id),
        buildOffset: 0,
        deployOffset: display.length
      }
    )
    await Deployment.appendDeployLog(
      deployment.id,
      events.accessUrl('URL', 'https://acaciaco.example')
    )
    await Deployment.appendDeployLog(
      deployment.id,
      'Docker stdout acaciaco prod'
    )
    await Deployment.appendDeployLog(deployment.id, 'uction\n')
    await Deployment.updateOne(deployment.id).set({ status: 'running' })
    await pending
    row = await Deployment.findOne(deployment.id)
    const reload = response({
      deploymentId: deployment.id,
      deployLogs: row.deployLogs
    }).deployLogs
    assert.equal(
      sent
        .filter((value) => value.source === 'deploy')
        .map((value) => value.output)
        .join(''),
      reload.slice(display.length)
    )
    assert.match(reload, /https:\/\/acaciaco.example/)
    assert.match(reload, /Docker stdout \[REDACTED\] \[REDACTED\]/)
    assert.doesNotMatch(reload, /SlipwayDeploymentEvent/)
    const other = await world.create('deployment').with({
      environment: world.current.environments.production.id,
      app: world.current.apps.web.id,
      deployLogs: row.deployLogs
    })
    assert.match(
      response({ deploymentId: other.id, deployLogs: other.deployLogs })
        .deployLogs,
      /Unverified deployment event/
    )
  }
)
