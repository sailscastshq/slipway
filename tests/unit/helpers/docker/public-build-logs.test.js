const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const childProcess = require('node:child_process')
const { test } = require('sounding')
const fixture = require('../../../support/public-log-identifiers-fixture')
test('Docker build streams keep public image and asset identity through both channels and persistence without exposing hidden values', async ({
  sails
}) => {
  const { hook } = fixture()
  const helperPath = require.resolve(
    '../../../../api/helpers/docker/build-image'
  )
  const process = new EventEmitter()
  process.stdout = new PassThrough()
  process.stderr = new PassThrough()
  process.kill = () => {}
  const original = {
    spawn: childProcess.spawn,
    hook: sails.hooks.secrets,
    append: Deployment.appendBuildLog,
    verbose: sails.log.verbose
  }
  const chunks = [],
    logged = []
  childProcess.spawn = () => process
  sails.hooks.secrets = hook
  sails.log.verbose = (value) => logged.push(hook.protect(value))
  Deployment.appendBuildLog = async (_id, value) =>
    chunks.push(hook.protect(value))
  delete require.cache[helperPath]
  try {
    const pending = require(helperPath).fn({
      contextPath: '/synthetic/context',
      imageName: 'slipway/acaciaco-production-acaciaco-example:123',
      dockerfilePath: 'Dockerfile',
      deploymentId: '123',
      buildArgs: { CUSTOM_BUILD: 'private-build-canary-768' },
      timeout: 10000,
      noCache: false
    })
    process.stdout.write('#12 naming to docker.io/slipway/acaciaco-pro')
    process.stdout.write('duction-acaciaco-example:123 done\n')
    process.stderr.write('.tmp/public/images/blog/introducing-aca')
    process.stderr.write('ciaco.jpg 47.0 kB\nprivate-build-canary-')
    process.stderr.write('768 confirmed-secret-canary-768\n')
    process.emit('close', 0)
    const result = await pending
    assert.equal(
      result.output,
      '#12 naming to docker.io/slipway/acaciaco-production-acaciaco-example:123 done\n'
    )
    assert.equal(
      chunks.join(''),
      result.output +
        '.tmp/public/images/blog/introducing-acaciaco.jpg 47.0 kB\n[REDACTED] [REDACTED]\n'
    )
    assert.equal(logged.join(''), chunks.join(''))
  } finally {
    childProcess.spawn = original.spawn
    sails.hooks.secrets = original.hook
    Deployment.appendBuildLog = original.append
    sails.log.verbose = original.verbose
    delete require.cache[helperPath]
  }
})
