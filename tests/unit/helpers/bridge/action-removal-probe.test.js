const { test } = require('sounding')
const assert = require('node:assert/strict')

test('removal navigation probe is bounded, primary-key-only and never reruns the helper', async ({
  sails
}) => {
  const original = {
    wrap: sails.helpers.bridge.buildSailsWrapper,
    execute: sails.helpers.bridge.executeInContainer
  }
  let behavior = 'removed',
    helperCalls = 0,
    probes = 0
  const identity = 'fixture'
  const action = {
    name: 'remove',
    scope: 'record',
    helper: 'bridge.remove',
    success: 'Done.'
  }
  try {
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (_container, code) => {
      const value = await new Function(
        'sails',
        `return (async () => {${code}})()`
      )({
        helpers: {
          bridge: {
            remove: {
              with: async () => {
                helperCalls++
                return behavior === 'void'
                  ? undefined
                  : {
                      message: 'Done.',
                      cleanupPending: behavior === 'pending',
                      ...(behavior === 'preview'
                        ? {
                            preview: {
                              type: 'video',
                              title: 'Fixture',
                              url: '/api/files/fixture/preview'
                            }
                          }
                        : {}),
                      recordRemoved: true
                    }
              }
            }
          }
        },
        models: {
          fixture: {
            findOne: (criteria) => {
              probes++
              assert.deepEqual(criteria, { uuid: 'doc-1' })
              return {
                select: (fields) => {
                  assert.deepEqual(fields, ['uuid'])
                  if (behavior === 'timeout') return new Promise(() => {})
                  if (behavior === 'error')
                    throw new Error('Private read failure')
                  return Promise.resolve(
                    behavior === 'exists' ? { uuid: 'doc-1' } : null
                  )
                }
              }
            }
          }
        }
      })
      return { success: true, output: JSON.stringify(value), exitCode: 0 }
    }
    const run = () =>
      sails.helpers.bridge.executeCustomAction.with({
        containerName: 'fixture',
        resource: { identity, primaryKey: 'uuid' },
        action,
        actor: { id: 1 },
        values: {},
        recordId: 'doc-1'
      })
    for (behavior of [
      'removed',
      'void',
      'exists',
      'error',
      'pending',
      'preview',
      'timeout'
    ]) {
      const before = probes,
        start = Date.now(),
        result = await run()
      assert.equal(
        result.recordRemoved === true,
        ['removed', 'void'].includes(behavior),
        behavior
      )
      assert.equal(
        probes - before,
        ['pending', 'preview'].includes(behavior) ? 0 : 1
      )
      if (behavior === 'timeout') assert.ok(Date.now() - start < 10000)
    }
    assert.equal(helperCalls, 7)
    action.scope = 'resource'
    const before = probes
    await run()
    assert.equal(probes, before)
  } finally {
    sails.helpers.bridge.buildSailsWrapper = original.wrap
    sails.helpers.bridge.executeInContainer = original.execute
  }
})
