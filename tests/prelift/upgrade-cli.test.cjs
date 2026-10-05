const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const commandPath = path.resolve(__dirname, '../../packages/cli/src/index.js')
test('CLI missing upgrade approval and invalid IDs return machine errors without network work', () => {
  for (const [args, code] of [
    [['upgrade:apply', '--json'], 'UPGRADE_APPROVAL_REQUIRED'],
    [['upgrade:resume', '../x', '--ndjson'], 'UPGRADE_ID_REQUIRED']
  ]) {
    try {
      execFileSync(process.execPath, [commandPath, ...args], {
        stdio: ['ignore', 'pipe', 'pipe']
      })
      assert.fail()
    } catch (error) {
      assert.equal(error.status, 1)
      assert.equal(error.stdout.toString(), '')
      assert.equal(JSON.parse(error.stderr.toString()).error.code, code)
    }
  }
})
test('CLI wait accepts only matching complete native receipts; NDJSON reports acceptance and phase changes', async () => {
  const { default: command } = await import(
    '../../packages/cli/src/lib/upgrade-command.js'
  )
  const id = '11111111-1111-1111-1111-111111111111'
  const accepted = {
    status: 'accepted',
    id,
    image: 'fixture-image',
    manifestHash: 'fixture-manifest',
    filename: '/private/checkpoint'
  }
  const options = {
    ndjson: true,
    instance: 'fixture',
    'approve-plan': 'a'.repeat(64),
    wait: true,
    timeout: '10'
  }
  const beforeLog = console.log,
    beforeError = console.error,
    beforeExit = process.exitCode
  const output = [],
    errors = []
  let time = 0,
    polls = 0
  try {
    console.log = (value) => output.push(JSON.parse(value))
    console.error = (value) => errors.push(JSON.parse(value))
    process.exitCode = 0
    await command('apply', options, [], {
      api: {
        post: async () => accepted,
        get: async () => {
          polls++
          return {
            phase: 'ready',
            image: polls === 1 ? 'wrong' : accepted.image,
            migration: {
              reconciled: true,
              pending: [],
              manifestHash: accepted.manifestHash
            }
          }
        }
      },
      now: () => time,
      delay: async () => {
        time += 2000
      }
    })
    assert.equal(polls, 2)
    assert.equal(errors.length, 0)
    assert.equal(process.exitCode, 0)
    assert.equal(output[0].type, 'upgrade.accepted')
    assert.equal(output.at(-1).phase, 'ready')
    output.length = 0
    await command(
      'apply',
      { ...options, json: true, ndjson: false, timeout: '2' },
      [],
      {
        api: {
          post: async () => accepted,
          get: async () => ({
            phase: 'ready',
            image: 'wrong',
            migration: {
              reconciled: true,
              pending: [],
              manifestHash: accepted.manifestHash
            }
          })
        },
        now: () => time,
        delay: async () => {
          time += 2000
        }
      }
    )
    assert.equal(output.length, 0)
    assert.equal(errors.at(-1).error.code, 'upgradeDispatchUnconfirmed')
    assert.equal(process.exitCode, 1)
  } finally {
    console.log = beforeLog
    console.error = beforeError
    process.exitCode = beforeExit
  }
})
