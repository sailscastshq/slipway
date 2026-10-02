const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test } = require('sounding')

// A Docker stand-in only records selection; no daemon, connection or test runs.
test('migration rehearsal requires a disposable local Docker target and respects context precedence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-guard-'))
  const calls = path.join(root, 'calls.json')
  const script = path.resolve('scripts/rehearse-coolify-migration.js')
  const docker = path.join(root, 'docker')
  await fs.writeFile(
    docker,
    `#!${process.execPath}\n` +
      `require('node:fs').writeFileSync(${JSON.stringify(
        calls
      )}, JSON.stringify(process.argv.slice(2)));\n` +
      `console.log(JSON.stringify([{Endpoints:{docker:{Host:'ssh://fixture.invalid'}}}]))\n`,
    { mode: 0o700 }
  )
  const invoke = (changes = {}) =>
    spawnSync(process.execPath, [script, '--docker'], {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        PATH: `${root}${path.delimiter}${process.env.PATH}`,
        SLIPWAY_MIGRATION_DISPOSABLE: '',
        DOCKER_HOST: '',
        DOCKER_CONTEXT: '',
        SLIPWAY_DOCKER_BINARY: '',
        sails_docker__binaryPath: '',
        sails_docker: '',
        ...changes
      }
    })
  try {
    const noApproval = invoke()
    assert.equal(noApproval.status, 1)
    assert.match(noApproval.stderr, /dedicated disposable Docker runner/)
    await assert.rejects(fs.access(calls))

    for (const name of [
      'SLIPWAY_DOCKER_BINARY',
      'sails_docker__binaryPath',
      'sails_docker'
    ]) {
      const override = invoke({
        SLIPWAY_MIGRATION_DISPOSABLE: '1',
        DOCKER_HOST: 'unix:///var/run/docker.sock',
        [name]: '/never-run/remote-docker-wrapper'
      })
      assert.equal(override.status, 1)
      assert.match(override.stderr, /Unset Docker runtime overrides/)
      assert.ok(override.stderr.includes(name))
      assert.equal(override.stderr.includes('/never-run/'), false)
      await assert.rejects(fs.access(calls))
    }

    const remoteHost = invoke({
      SLIPWAY_MIGRATION_DISPOSABLE: '1',
      DOCKER_HOST: 'tcp://fixture.invalid:2375'
    })
    assert.equal(remoteHost.status, 1)
    assert.match(remoteHost.stderr, /local Unix socket context/)
    await assert.rejects(fs.access(calls))

    const contextOverridesHost = invoke({
      SLIPWAY_MIGRATION_DISPOSABLE: '1',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
      DOCKER_CONTEXT: 'remote-fixture'
    })
    assert.equal(contextOverridesHost.status, 1)
    assert.match(contextOverridesHost.stderr, /local Unix socket context/)
    assert.deepEqual(JSON.parse(await fs.readFile(calls, 'utf8')), [
      'context',
      'inspect',
      'remote-fixture'
    ])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
