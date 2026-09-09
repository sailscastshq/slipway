const { test } = require('sounding')
const assert = require('node:assert/strict')
const resolve = require('../../../packages/hook/lib/wake-identity')
function app(slipway = {}, models = {}, helpers = {}) {
  return { config: { slipway }, models, helpers }
}

test('Wake resolves default and creator sessions without email or verification fields', async () => {
  const model = {
    findOne: async ({ id }) => ({
      id,
      email: 'never-export@example.test',
      secret: 'never-export'
    })
  }
  assert.deepEqual(
    await resolve(app({}, { user: model }), { session: { userId: 42 } }),
    { id: '42' }
  )
  assert.deepEqual(
    await resolve(
      app(
        { identity: { model: 'creator', sessionKey: 'creatorId' } },
        { creator: model }
      ),
      { session: { creatorId: 'creator-7' } }
    ),
    { id: 'creator-7' }
  )
})
test('Wake leaves sessionless apps anonymous without creating sessions or requiring models', async () => {
  const req = {}
  assert.equal(await resolve(app(), req), null)
  assert.deepEqual(req, {})
})
test('Wake helper resolves a verified principal and null never falls back to another session', async () => {
  const runtime = app(
    { wake: { identity: { helper: 'wake.identity' } } },
    {},
    { wake: { identity: { with: async ({ req }) => req.principal || null } } }
  )
  assert.deepEqual(
    await resolve(runtime, { principal: { id: 'verified-account' } }),
    { id: 'verified-account' }
  )
  assert.equal(
    await resolve(runtime, { session: { userId: 'someone-else' } }),
    null
  )
})
test('Wake identity errors are anonymous and diagnostics cannot leak error contents', async () => {
  const messages = []
  const runtime = app(
    { wake: { identity: { helper: 'wake.identity' } } },
    {},
    {
      wake: {
        identity: {
          with: async () => {
            throw new Error('private token')
          }
        }
      }
    }
  )
  assert.equal(await resolve(runtime, {}, (code) => messages.push(code)), null)
  assert.deepEqual(messages, ['identity_unavailable'])
  assert.equal(
    await resolve(runtime, {}, () => {
      throw Error('logging failed')
    }),
    null
  )
})
test('Wake-specific mapping overrides shared and legacy mappings', async () => {
  const runtime = app(
    {
      bridge: { identity: { model: 'legacy', sessionKey: 'legacyId' } },
      identity: { model: 'creator', sessionKey: 'creatorId' },
      wake: { identity: { model: 'member', sessionKey: 'memberId' } }
    },
    { member: { findOne: async ({ id }) => ({ id }) } }
  )
  assert.deepEqual(
    await resolve(runtime, {
      session: { memberId: 'member-1', creatorId: 'creator-1' }
    }),
    { id: 'member-1' }
  )
})
