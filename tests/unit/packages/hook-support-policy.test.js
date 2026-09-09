const { test } = require('sounding')
const assert = require('node:assert/strict')
const policy = require('../../../packages/hook/lib/bridge-support-policy')
test('support views deny undeclared GET surfaces and protected targets, including custom identity mappings', async () => {
  const host = {
    config: {
      slipway: {
        identity: { model: 'creator', sessionKey: 'creatorId' },
        bridge: {
          impersonation: {
            enabled: true,
            readOnlyPaths: ['/', '/workspace', '/export', '/password']
          }
        }
      }
    }
  }
  assert.equal(policy.configuration(host).sessionKey, 'creatorId')
  assert.equal(policy.configuration(host).model, 'creator')
  assert.equal(
    policy.approvedRequest({ method: 'GET', path: '/workspace' }, host),
    true
  )
  for (const path of [
    '/export',
    '/%65xport',
    '/password',
    '/unknown',
    '/api/customer-dump'
  ])
    assert.equal(policy.approvedRequest({ method: 'GET', path }, host), false)
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
    assert.equal(policy.approvedRequest({ method, path: '/' }, host), false)
  for (const target of [
    null,
    { role: 'owner' },
    { isAdmin: true },
    { status: 'suspended' },
    { deletedAt: 1 },
    { isServiceAccount: true }
  ])
    assert.equal(policy.protectedTarget(target), true)
  assert.equal(policy.protectedTarget({ id: 42, role: 'customer' }), false)
})
