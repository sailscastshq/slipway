const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { randomUUID } = require('node:crypto')
const execute = promisify(execFile)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function upstreamSource(env = process.env) {
  assert.ok(
    env.SLIPWAY_QUEST_UPSTREAM_ROOT,
    'SLIPWAY_QUEST_UPSTREAM_ROOT must name a real, explicit upstream checkout; installed Quest is never a fallback'
  )
  const root = await fs.realpath(env.SLIPWAY_QUEST_UPSTREAM_ROOT)
  assert.ok(!/[,:\r\n]/.test(root), 'Unsupported upstream mount separators')
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, 'package.json'), 'utf8')
  )
  assert.equal(
    manifest.name,
    'sails-hook-quest',
    'Actual upstream Quest package required'
  )
  assert.ok(manifest.main && !path.isAbsolute(manifest.main))
  const entry = await fs.realpath(path.resolve(root, manifest.main))
  assert.ok(entry.startsWith(`${root}${path.sep}`))
  const sha = env.SLIPWAY_QUEST_UPSTREAM_SHA
  assert.match(
    sha || '',
    /^[a-f0-9]{40}$/,
    'SLIPWAY_QUEST_UPSTREAM_SHA must be the verified full commit SHA'
  )
  assert.notEqual(
    sha,
    '788d767132dab969a6602bdb9d718c17a8ce8a7c',
    'Unsafe superseded child-scheduler implementation is blocked'
  )
  const git = (args) =>
    execute('git', ['-C', root, ...args], {
      timeout: 5000,
      maxBuffer: 1024 * 1024
    })
  assert.equal(
    (await git(['rev-parse', 'HEAD'])).stdout.trim(),
    sha,
    'Upstream must match the asserted pin'
  )
  assert.equal(
    (
      await git(['status', '--porcelain', '--untracked-files=no'])
    ).stdout.trim(),
    '',
    'Pinned upstream tracked source must be clean'
  )
  return { root, sha, version: manifest.version }
}

async function createFixture(app, options = {}) {
  // This gate precedes all Docker activity, never silently skipping integration.
  const source = await upstreamSource(options.env || process.env)
  const docker = process.env.SLIPWAY_DOCKER_BINARY || 'docker'
  const image =
    process.env.SLIPWAY_QUEST_RESIDENT_IMAGE || 'node:22-bookworm-slim'
  const name = `slipway-quest-resident-test-${randomUUID()}`
  const command = (args) =>
    execute(docker, args, { timeout: 30000, maxBuffer: 1024 * 1024 })
  const inspect = async (mode) =>
    JSON.parse(
      (
        await command([
          'exec',
          name,
          'node',
          '/host/tests/fixtures/quest-resident/inspect.cjs',
          mode
        ])
      ).stdout
    )
  let attempted = false
  const fixture = {
    name,
    source,
    docker,
    command,
    inspect,
    async waitFor(read, predicate, description, timeout = 20000) {
      const deadline = Date.now() + timeout
      let latest, failure
      do {
        try {
          latest = await read()
          if (predicate(latest)) return latest
        } catch (error) {
          if (error.fixtureFatal) throw error
          failure = error
        }
        if (Date.now() >= deadline) break
        await sleep(100)
      } while (true)
      throw new Error(
        `Timed out waiting for ${description}: ${String(
          failure?.message || JSON.stringify(latest)
        ).slice(-2048)}`
      )
    },
    async diagnose() {
      if (!attempted) return
      for (const args of [
        ['inspect', '--format', '{{json .State}}', name],
        ['logs', '--tail', '80', name]
      ]) {
        try {
          const result = await execute(docker, args, {
            timeout: 5000,
            maxBuffer: 128 * 1024
          })
          console.error(
            '[Quest resident fixture]',
            (result.stdout + result.stderr).slice(-16384)
          )
        } catch (error) {
          console.error(
            '[Quest resident fixture]',
            String(error.message).slice(-2048)
          )
        }
      }
    },
    async close() {
      if (!attempted) return
      try {
        await command(['rm', '-f', name])
      } catch (error) {
        if (!/No such container/i.test(error.stderr || '')) throw error
      }
      attempted = false
    }
  }
  try {
    await command(['image', 'inspect', image]) // CI prepares it, never implicit pull.
    const dependencies = await fs.realpath('node_modules')
    attempted = true // Uncertain Docker start must still clean up this exact name.
    await command([
      'run',
      '-d',
      '--init',
      '--name',
      name,
      '--network',
      'none',
      '--read-only',
      '--memory',
      '512m',
      '--tmpfs',
      '/app:rw,size=16m',
      '--tmpfs',
      '/tmp:rw,size=32m',
      '-v',
      `${path.resolve('.')}:/host:ro`,
      '-v',
      `${dependencies}:/fixture/node_modules:ro`,
      '-v',
      `${path.resolve('packages')}:/fixture/packages:ro`,
      '-v',
      `${path.resolve('assets')}:/fixture/assets:ro`,
      '-v',
      `${source.root}:/fixture/node_modules/sails-hook-quest:ro`,
      '-w',
      '/app',
      '-e',
      'NODE_ENV=staging',
      '-e',
      'SLIPWAY_QUEST_FIXTURE=1',
      '-e',
      `SLIPWAY_APP_ID=${app.id}`,
      '-e',
      `SLIPWAY_DEPLOYMENT_ID=${app.currentDeployment}`,
      image,
      'node',
      '/host/tests/fixtures/quest-resident/container.cjs'
    ])
    fixture.ready = await fixture.waitFor(
      async () => {
        const state = await command([
          'inspect',
          '--format',
          '{{.State.Running}}',
          name
        ])
        if (state.stdout.trim() !== 'true')
          throw Object.assign(new Error('Worker exited before readiness'), {
            fixtureFatal: true
          })
        return inspect('ready')
      },
      (value) => Boolean(value.runtimeId),
      'actual full-hook worker registration'
    )
    return fixture
  } catch (error) {
    await fixture.diagnose()
    await fixture
      .close()
      .catch((cleanupError) =>
        console.error('[Quest fixture cleanup]', cleanupError.message)
      )
    throw error
  }
}
module.exports = { createFixture, upstreamSource, sleep }
