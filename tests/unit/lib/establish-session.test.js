const { test } = require('sounding')
const establishSession = require('../../../api/lib/establish-session')

test('sign-in rotates the session and drops previous app-scoped privileges', async ({
  expect
}) => {
  const previousSails = global.sails
  const closed = []
  global.sails = { sse: { revoke: (principal) => closed.push(principal) } }
  try {
    const req = {
      sessionID: 'old',
      session: {
        userId: 1,
        bridgeAccessId: 9,
        regenerate(callback) {
          req.sessionID = 'new'
          req.session = { cookie: {} }
          callback()
        }
      }
    }
    await establishSession(
      req,
      { id: 2, authVersion: 'new-version' },
      { maxAge: 12345 }
    )
    expect(req.sessionID).toBe('new')
    expect(req.session.userId).toBe(2)
    expect(req.session.authVersion).toBe('new-version')
    expect(req.session.bridgeAccessId).toBe(undefined)
    expect(req.session.cookie.maxAge).toBe(12345)
    expect(closed).toEqual([{ sessionId: 'old' }])
  } finally {
    global.sails = previousSails
  }
})
