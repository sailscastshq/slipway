const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const helper = require('../api/helpers/dock/get-models')

async function main() {
  const image = process.env.SLIPWAY_SCHEMA_FIXTURE_IMAGE
  if (!image)
    throw new Error(
      'Set SLIPWAY_SCHEMA_FIXTURE_IMAGE to the built fixture image.'
    )
  const containerName = `slipway-schema-fixture-${randomUUID()}`
  global.sails = { config: { docker: { binaryPath: 'docker' } } }
  try {
    execFileSync('docker', ['run', '-d', '--name', containerName, image], {
      stdio: 'pipe'
    })
    const running = await helper.fn({ containerName })
    assert.equal(running.authoritative, true, running.error)
    execFileSync('docker', ['stop', '-t', '1', containerName], {
      stdio: 'pipe'
    })
    const stopped = await helper.fn({ containerName })
    assert.equal(stopped.authoritative, true, stopped.error)
    assert.deepEqual(stopped, running)
    assert.equal(stopped.models.user.attributes.email.unique, true)
    assert.equal(stopped.models.user.attributes.id.autoIncrement, true)
    assert.equal(stopped.models.user.attributes.account.type, 'string')
    assert.equal(stopped.models.user.attributes.manager.type, 'number')
    assert.equal(stopped.models.user.attributes.account.autoIncrement, false)
    assert.equal(stopped.models.user.attributes.createdAt, undefined)
    assert.equal(stopped.models.account.attributes.members, undefined)
    assert.equal(
      execFileSync(
        'docker',
        ['inspect', '--format', '{{.State.Running}}', containerName],
        { encoding: 'utf8' }
      ).trim(),
      'false'
    )
    console.log(
      'Running/stopped canonical schema parity passed; the app remained stopped.'
    )
  } finally {
    execFileSync('docker', ['rm', '-f', '-v', containerName], { stdio: 'pipe' })
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
