const assert = require('node:assert/strict')
const { test } = require('node:test')
const { EventEmitter } = require('node:events')
const ledger = require('../../../api/lib/quest-run-ledger')
const action = require('../../../api/controllers/api/v1/quest/get-run-logs')

test('concurrent live viewer admission reserves at most 128 slots and releases pending aborts and failed reads', async (t) => {
  const rejects = []
  t.mock.method(
    ledger,
    'resolveScope',
    () => new Promise((_resolve, reject) => rejects.push(reject))
  )
  const contexts = []
  const input = {
    stream: true,
    projectSlug: 'synthetic',
    environmentSlug: 'production',
    runId: 'synthetic-run',
    afterSequence: 0
  }
  const open = () => {
    const req = new EventEmitter(),
      res = new EventEmitter()
    req.headers = {}
    req.aborted = false
    res.destroyed = false
    const context = { req, res }
    contexts.push(context)
    return action.fn.call(context, input)
  }
  const pending = Array.from({ length: 128 }, () =>
    open().catch((error) => error)
  )
  assert.equal(rejects.length, 128)
  await assert.rejects(open, (error) => error === 'tooManyRequests')
  assert.equal(rejects.length, 128, 'over-cap request performs no scope read')
  for (const { req } of contexts.slice(0, 128)) {
    req.aborted = true
    req.emit('aborted')
  }
  const next = open().catch((error) => error)
  assert.equal(
    rejects.length,
    129,
    'pending aborted requests returned their slots'
  )
  for (const reject of rejects) reject('notFound')
  assert.deepEqual(await Promise.all(pending), Array(128).fill('notFound'))
  assert.equal(await next, 'notFound')
  const final = open().catch((error) => error)
  assert.equal(
    rejects.length,
    130,
    'every failed scope read also returned its slot'
  )
  rejects.at(-1)('notFound')
  assert.equal(await final, 'notFound')
  for (const { req, res } of contexts) {
    assert.equal(req.listenerCount('aborted'), 0)
    assert.equal(res.listenerCount('close'), 0)
  }
})
