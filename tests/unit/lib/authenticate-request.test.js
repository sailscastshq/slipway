const { test } = require('sounding')
const authenticateRequest = require('../../../api/lib/authenticate-request')

test('a bearer principal stays request-local and requires a live user', async ({
  expect
}) => {
  const originals = { User: global.User, CliToken: global.CliToken }
  let exists = true
  try {
    global.User = { findOne: async () => (exists ? { id: 7 } : null) }
    global.CliToken = {
      findOne: async () => ({ id: 8, user: 7 }),
      updateOne: () => ({ set: async () => {} })
    }
    const req = { session: {}, headers: { authorization: 'Bearer sl_fake' } }
    expect((await authenticateRequest(req)).id).toBe(7)
    expect(req.auth.tokenId).toBe(8)
    expect(req.session.userId).toBe(undefined)
    exists = false
    expect(await authenticateRequest(req)).toBe(null)
    expect(req.auth).toBe(undefined)
  } finally {
    global.User = originals.User
    global.CliToken = originals.CliToken
  }
})
