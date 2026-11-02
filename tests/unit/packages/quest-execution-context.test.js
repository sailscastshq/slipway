const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  isQuestExecutionChild
} = require('../../../packages/hook/lib/quest-execution-context')
const {
  registerHelmRuntime
} = require('../../../packages/hook/lib/helm-runtime-contract')
test('legacy CLI children and process-local reused children are transient, ordinary apps stay resident', (t) => {
  assert.equal(
    isQuestExecutionChild({
      argv: ['node', '/app/node_modules/.bin/sails', 'run', 'job']
    }),
    true
  )
  assert.equal(
    isQuestExecutionChild({ argv: ['node', '/app/sails.js', 'run', 'job'] }),
    true
  )
  assert.equal(
    isQuestExecutionChild({
      argv: ['node', '/app/app.js'],
      env: { QUEST_WORKER_GENERATION: 'not-authority' }
    }),
    false
  )
  const marker = Symbol.for('sails.quest.executionChild')
  const previous = Object.getOwnPropertyDescriptor(globalThis, marker)
  Object.defineProperty(globalThis, marker, { value: true, configurable: true })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, marker, previous)
    else delete globalThis[marker]
  })
  assert.equal(
    isQuestExecutionChild({ argv: ['node', '/package/worker-child.js'] }),
    true
  )
  const runtime = {
    platform: 'linux',
    argv: ['node', '/package/worker-child.js'],
    env: { SLIPWAY_APP_ID: '7', SLIPWAY_DEPLOYMENT_ID: '42' }
  }
  assert.equal(
    registerHelmRuntime({
      appId: '7',
      deploymentId: '42',
      sailsApp: {},
      runtime,
      filesystem: {
        readFileSync() {
          throw Error('must not inspect/publish a child as the app')
        }
      }
    }),
    null
  )
})

test(
  'the actual new Quest marker interoperates without an environment switch',
  { skip: !process.env.QUEST_TEST_SOURCE },
  () => {
    const path = require('node:path')
    const { spawnSync } = require('node:child_process')
    const code = `require(${JSON.stringify(
      path.join(process.env.QUEST_TEST_SOURCE, 'lib/core/execution-child')
    )}).markExecutionChild();require('node:assert/strict').equal(require(${JSON.stringify(
      require.resolve('../../../packages/hook/lib/quest-execution-context')
    )}).isQuestExecutionChild(),true)`
    const result = spawnSync(process.execPath, ['-e', code], {
      encoding: 'utf8',
      timeout: 5000
    })
    assert.equal(result.status, 0, result.stderr)
  }
)
