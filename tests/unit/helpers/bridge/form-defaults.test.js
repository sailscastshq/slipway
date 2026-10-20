const { test } = require('sounding')
const assert = require('node:assert/strict')
const {
  models,
  config,
  provider
} = require('../../../support/bridge-dependent-defaults')

test('Bridge defaults contracts reject unsafe helper names, protected targets and dependency cycles', async ({
  sails
}) => {
  const normalize = (defaultsProvider) =>
    sails.helpers.bridge.normalizeResourceContract.with({
      models,
      config: {
        resources: {
          session: { ...config.resources.session, defaultsProvider }
        }
      }
    })
  assert.deepEqual(
    (await normalize(provider)).resources.session.defaultsProvider,
    provider
  )
  for (const invalid of [
    { ...provider, helper: 'constructor.bad' },
    { ...provider, fields: ['secret'] },
    { ...provider, fields: ['proposal'] },
    { ...provider, fields: ['id'] },
    { ...provider, dependsOn: [] },
    { ...provider, fields: ['missing'] },
    { ...provider, fields: ['title', 'title'] },
    { ...provider, extra: true }
  ])
    await assert.rejects(normalize(invalid))
})

test('Bridge authorizes relationship dependencies before the provider and returned targets before release', async ({
  sails
}) => {
  const originals = { ...sails.helpers.bridge }
  const resource = (
    await sails.helpers.bridge.normalizeResourceContract.with({
      models,
      config
    })
  ).resources.session
  const auth = [],
    executions = []
  let rejectInput = false,
    rejectOutput = false
  sails.helpers.bridge.authorizeRelationshipValues = {
    with: async (args) => {
      auth.push(args.values)
      if (rejectInput || (rejectOutput && args.values.track))
        throw new Error('Foreign event relationship')
    }
  }
  sails.helpers.bridge.buildSailsWrapper = async (code) => code
  sails.helpers.bridge.executeInContainer = async (_name, code) => {
    executions.push(code)
    return {
      success: true,
      output: JSON.stringify({ values: { track: 'Main' } })
    }
  }
  const args = {
    containerName: 'fixture',
    environmentId: 3,
    resource,
    actor: { id: 5 },
    surface: 'create',
    values: { event: 'event-1', proposal: 'proposal-1' }
  }
  try {
    assert.deepEqual(await originals.loadFormDefaults.with(args), {
      values: { track: 'Main' }
    })
    assert.deepEqual(auth, [args.values, { ...args.values, track: 'Main' }])
    rejectInput = true
    await assert.rejects(originals.loadFormDefaults.with(args), /Foreign event/)
    assert.equal(executions.length, 1)
    rejectInput = false
    rejectOutput = true
    await assert.rejects(originals.loadFormDefaults.with(args), /Foreign event/)
    assert.deepEqual(
      await originals.loadFormDefaults.with({
        ...args,
        values: { event: 'event-1', proposal: '' }
      }),
      { values: {} }
    )
  } finally {
    Object.assign(sails.helpers.bridge, originals)
  }
})
