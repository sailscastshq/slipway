const { test } = require('node:test')
const assert = require('node:assert/strict')
const { read } = require('../../../api/lib/cache-cleanup-progress')

test('cleanup progress is bound to the admitted request and bounded before presentation', async () => {
  let value = {
    requestId: 'request-a',
    phase: 'pruning',
    startedAt: 1,
    updatedAt: 2,
    dockerReportedReclaimed: null,
    filesystemAvailableDeltaBytes: null,
    holds: [],
    secret: 'must-not-be-presented'
  }
  const sails = {
    models: {
      setting: {
        findOne: async () => ({
          value: typeof value === 'string' ? value : JSON.stringify(value)
        })
      }
    }
  }
  assert.equal(await read(sails, 'request-b'), null)
  const progress = await read(sails, 'request-a')
  assert.equal(progress.phase, 'pruning')
  assert.equal(progress.filesystemAvailableDeltaBytes, null)
  assert.equal(Object.hasOwn(progress, 'secret'), false)
  value.phase = 'refreshing'
  assert.equal((await read(sails, 'request-a')).phase, 'refreshing')
  value.phase = 'complete'
  value.filesystemAvailableDeltaBytes = -1024
  assert.equal(
    (await read(sails, 'request-a')).filesystemAvailableDeltaBytes,
    -1024
  )
  value = '{invalid'
  assert.equal(await read(sails, 'request-a'), null)
  value = 'x'.repeat(32769)
  assert.equal(await read(sails, 'request-a'), null)
})
