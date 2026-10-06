const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const helper = require('../../api/helpers/system/build-update-swap-script')

async function simulate({
  failRename = false,
  failRun = false,
  preflight = false
} = {}) {
  const script = await helper.fn({
    runArgs: ['run', '-d', '--name', 'slipway', 'candidate'],
    containerName: 'slipway',
    backupContainerName: 'slipway-previous'
  })
  const calls = []
  let now = 0
  let exitCode
  vm.runInNewContext(script, {
    require: (name) => {
      assert.equal(name, 'child_process')
      return {
        execFileSync(binary, args) {
          assert.equal(binary, 'docker')
          calls.push([...args])
          if (failRename && args[0] === 'rename' && args[1] === 'slipway')
            throw new Error('rename failed')
          if (failRun && args[0] === 'run') throw new Error('run failed')
          if (args[0] === 'exec')
            return Buffer.from(
              JSON.stringify(
                preflight
                  ? { mode: 'preflight', normalStartupReady: false }
                  : { status: 'ok' }
              )
            )
          return Buffer.from('')
        }
      }
    },
    console: { log() {}, error() {} },
    setTimeout: (fn) => fn(),
    Atomics: {
      wait: (_, __, ___, ms) => {
        now += ms
      }
    },
    Int32Array,
    SharedArrayBuffer,
    Date: { now: () => now },
    process: {
      exit: (code) => {
        exitCode = code
      }
    }
  })
  return { calls: calls.map((args) => args.join(' ')), exitCode }
}

test('the update stops the old writer before candidate startup and removes it only after normal health', async () => {
  const { calls, exitCode } = await simulate()
  assert.equal(exitCode, undefined)
  assert.ok(
    calls.indexOf('stop slipway-previous') <
      calls.indexOf('run -d --name slipway candidate')
  )
  assert.ok(
    calls.lastIndexOf('rm -f slipway-previous') >
      calls.findIndex((command) => command.startsWith('exec slipway curl'))
  )
  assert.equal(calls.includes('start slipway'), false)
})

test('a failed rename never deletes or restarts the still-current server', async () => {
  const { calls, exitCode } = await simulate({ failRename: true })
  assert.equal(exitCode, 1)
  assert.equal(calls.includes('rm -f slipway'), false)
  assert.equal(calls.includes('start slipway'), false)
})

test('failed startup restores the old container without copying a database over committed migrations', async () => {
  const { calls, exitCode } = await simulate({ failRun: true })
  assert.equal(exitCode, 1)
  assert.ok(calls.includes('rm -f slipway'))
  assert.ok(calls.includes('rename slipway-previous slipway'))
  assert.ok(calls.includes('start slipway'))
  assert.equal(
    calls.some((command) => command.startsWith('cp ')),
    false
  )
})

test('preflight HTTP success cannot admit a production candidate', async () => {
  const { calls, exitCode } = await simulate({ preflight: true })
  assert.equal(exitCode, 1)
  assert.ok(calls.includes('start slipway'))
})
