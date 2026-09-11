const { test } = require('sounding')
const {
  models,
  config
} = require('../../../support/bridge-conditional-actions')
const conditions = require('../../../../api/lib/bridge-action-conditions')

test('Bridge normalizes record action conditions and matches equality, in and AND without coercion', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models,
    config: config()
  })
  const action = contract.resources.proposal.actionDefinitions.sendDecision
  expect(action.slug).toBe('send-decision')
  expect(conditions.matches(action.visibleWhen, { status: 'accepted' })).toBe(
    true
  )
  expect(conditions.matches(action.visibleWhen, { status: 'draft' })).toBe(
    false
  )
  expect(
    Object.keys(conditions.effective(action, { status: 'accepted' }).fields)
  ).toEqual(['acceptanceMessage'])
  expect(
    Object.keys(conditions.effective(action, { status: 'rejected' }).fields)
  ).toEqual(['reason'])
  expect(
    conditions.matches(
      { 'record.status': 'accepted', 'record.id': { in: [1, 2] } },
      { status: 'accepted', id: 1 }
    )
  ).toBe(true)
  expect(
    conditions.matches(
      { 'record.status': 'accepted', 'record.id': { in: [1, 2] } },
      { status: 'accepted', id: '1' }
    )
  ).toBe(false)
  expect(conditions.matches({ 'record.id': null }, {})).toBe(false)
  expect(conditions.matches({ 'record.id': null }, { id: null })).toBe(true)
})

test('Bridge rejects unsafe or unsupported action condition configuration', async ({
  sails,
  expect
}) => {
  for (const condition of [
    {},
    { status: 'accepted' },
    { 'record.status.deep': 'accepted' },
    { 'record.secret': 'x' },
    { 'record.unknown': true },
    { 'record.constructor': 'x' },
    { 'record.status': { eq: 'accepted' } },
    { 'record.status': { in: [] } },
    { 'record.status': { in: ['accepted'], not: true } },
    { 'record.status': () => true }
  ]) {
    const input = config()
    input.resources.proposal.actions.sendDecision.visibleWhen = condition
    let error
    try {
      await sails.helpers.bridge.normalizeResourceContract.with({
        models,
        config: input
      })
    } catch (e) {
      error = e
    }
    expect(Boolean(error)).toBe(true)
  }
  for (const scope of ['resource', 'bulk']) {
    const input = config()
    input.resources.proposal.actions.sendDecision.scope = scope
    let error
    try {
      await sails.helpers.bridge.normalizeResourceContract.with({
        models,
        config: input
      })
    } catch (e) {
      error = e
    }
    expect(error.message).toContain('record scope')
  }
  const input = config()
  input.resources.proposal.show = ['id', 'title']
  let error
  try {
    await sails.helpers.bridge.normalizeResourceContract.with({
      models,
      config: input
    })
  } catch (e) {
    error = e
  }
  expect(error.message).toContain('visible, non-sensitive')
})
