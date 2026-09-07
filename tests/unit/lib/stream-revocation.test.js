const { EventEmitter } = require('node:events')
const { test } = require('sounding')
const defineSseHook = require('../../../api/hooks/sse')

test('revocation closes matching live streams without disconnecting other users', async ({
  expect
}) => {
  const sails = Object.assign(new EventEmitter(), {
    log: { info() {}, warn() {} }
  })
  const hook = defineSseHook(sails)
  await hook.initialize()
  const streams = []
  try {
    for (const auth of [
      { userId: 1, tokenId: 2, method: 'bearer' },
      { userId: 1, sessionId: 'browser', method: 'session' },
      { userId: 3, tokenId: 4, method: 'bearer' }
    ]) {
      const req = Object.assign(new EventEmitter(), { auth })
      const res = Object.assign(new EventEmitter(), {
        writeHead() {},
        write() {},
        end() {
          this.writableEnded = true
        }
      })
      hook.routes.before['/*'].fn(req, res, () => {})
      streams.push(res.sse())
    }
    sails.sse.revoke({ tokenId: 2 })
    expect(streams[0].closed).toBe(true)
    expect(streams[1].closed).toBe(false)
    expect(streams[2].closed).toBe(false)
    sails.sse.revoke({ userId: 1 })
    expect(streams[1].closed).toBe(true)
    expect(streams[2].closed).toBe(false)
  } finally {
    await new Promise((resolve) => hook.teardown(resolve))
  }
})
