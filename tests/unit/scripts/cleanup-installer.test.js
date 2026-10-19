const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const source = fs.readFileSync(require.resolve('../../../install.sh'), 'utf8')
const start = source.indexOf('SLIPWAY_IMAGE_RETENTION_REMOVE="${REQUESTED_')
const end = source.indexOf('SLIPWAY_INGRESS="${REQUESTED_', start)
const resolvePolicy = source.slice(start, end)
const runContainer = source.match(/run_slipway_container\(\) \{[\s\S]*?\n\}/)[0]

test('installer upgrades forward cleanup defaults and preserve an explicit saved or requested opt-out', () => {
  for (const [saved, requested, expected] of [
    ['', '', 'true'],
    ['false', '', 'false'],
    ['true', 'false', 'false'],
    ['false', 'true', 'true']
  ]) {
    const output = execFileSync(
      'bash',
      [
        '-c',
        `${resolvePolicy}\n${runContainer}\ndocker() { printf '%s\\n' "$@"; }\nrun_slipway_container fixture-slipway 1337`
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          SLIPWAY_IMAGE_RETENTION_REMOVE: saved,
          REQUESTED_SLIPWAY_IMAGE_RETENTION_REMOVE: requested,
          SLIPWAY_IMAGE: 'fixture:local'
        }
      }
    )
      .trim()
      .split('\n')
    const setting = output.indexOf(`SLIPWAY_IMAGE_RETENTION_REMOVE=${expected}`)
    assert.ok(setting > 0)
    assert.equal(output[setting - 1], '-e')
    assert.ok(output.includes('fixture:local'))
  }
  assert.throws(() =>
    execFileSync('bash', ['-c', resolvePolicy], {
      env: {
        ...process.env,
        SLIPWAY_IMAGE_RETENTION_REMOVE: 'invalid',
        REQUESTED_SLIPWAY_IMAGE_RETENTION_REMOVE: ''
      },
      stdio: 'pipe'
    })
  )
})

test('installer forwards and persists independent build-cache removal opt-outs', () => {
  for (const [saved, requested, expected] of [
    ['', '', 'true'],
    ['false', '', 'false'],
    ['true', 'false', 'false'],
    ['false', 'true', 'true']
  ]) {
    const output = execFileSync(
      'bash',
      [
        '-c',
        `${resolvePolicy}\n${runContainer}\ndocker() { printf '%s\\n' "$@"; }\nrun_slipway_container fixture-slipway 1337`
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          SLIPWAY_BUILD_CACHE_RETENTION_REMOVE: saved,
          REQUESTED_SLIPWAY_BUILD_CACHE_RETENTION_REMOVE: requested,
          SLIPWAY_IMAGE_RETENTION_REMOVE: 'true',
          SLIPWAY_IMAGE: 'fixture:local'
        }
      }
    )
      .trim()
      .split('\n')
    const index = output.indexOf(
      `SLIPWAY_BUILD_CACHE_RETENTION_REMOVE=${expected}`
    )
    assert.ok(index > 0)
    assert.equal(output[index - 1], '-e')
  }
  assert.match(source, /persist_setting SLIPWAY_BUILD_CACHE_RETENTION_REMOVE/)
  assert.throws(() =>
    execFileSync('bash', ['-c', resolvePolicy], {
      env: {
        ...process.env,
        SLIPWAY_BUILD_CACHE_RETENTION_REMOVE: 'invalid',
        SLIPWAY_IMAGE_RETENTION_REMOVE: 'true'
      },
      stdio: 'pipe'
    })
  )
})
