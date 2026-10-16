const { test } = require('sounding')
const assert = require('node:assert/strict')
function fixture() {
  return {
    models: {
      event: {
        identity: 'event',
        primaryKey: 'id',
        attributes: { id: { type: 'string' }, title: { type: 'string' } }
      }
    },
    config: {
      resources: {
        event: {
          title: 'title',
          show: ['id', 'title'],
          actions: {
            email: {
              scope: 'record',
              helper: 'bridge.email',
              fields: {
                selectionMode: {
                  type: 'select',
                  required: true,
                  default: 'everyone',
                  options: ['everyone', 'selected']
                },
                audience: {
                  type: 'select',
                  required: true,
                  default: 'all',
                  options: ['all', 'attendees']
                },
                people: {
                  type: 'multiselect',
                  required: true,
                  default: [],
                  visibleWhen: { 'form.selectionMode': 'selected' },
                  optionsProvider: {
                    helper: 'bridge.people',
                    dependsOn: ['audience']
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
test('action multiselect contracts reject executable identities, unsupported scopes and dependency shapes', async ({
  sails
}) => {
  const f = fixture()
  const contract = await sails.helpers.bridge.normalizeResourceContract.with(f)
  const field = contract.resources.event.actionDefinitions.email.fields.people
  assert.equal(field.type, 'json')
  assert.equal(field.field.type, 'multiselect')
  assert.deepEqual(field.field.optionsProvider, {
    helper: 'bridge.people',
    dependsOn: ['audience']
  })
  for (const mutate of [
    (a) => (a.scope = 'resource'),
    (a) => (a.fields.people.optionsProvider.helper = 'bridge.constructor'),
    (a) => (a.fields.people.optionsProvider.dependsOn = ['people']),
    (a) => (a.fields.people.optionsProvider.url = 'https://example.com'),
    (a) => (a.fields.people.default = ['injected'])
  ]) {
    const bad = fixture()
    mutate(bad.config.resources.event.actions.email)
    await assert.rejects(() =>
      sails.helpers.bridge.normalizeResourceContract.with(bad)
    )
  }
})
test('required action selection fails closed while hidden selection preserves legacy Everyone', async ({
  sails
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with(
    fixture()
  )
  const resource = contract.resources.event,
    action = resource.actionDefinitions.email
  const allow = (values) =>
    sails.helpers.bridge.allowActionValues.with({ resource, action, values })
  assert.deepEqual(await allow({}), {
    selectionMode: 'everyone',
    audience: 'all'
  })
  for (const people of [
    [],
    null,
    'id',
    ['id', 'id'],
    [{}],
    Array(101).fill('id')
  ])
    await assert.rejects(() => allow({ selectionMode: 'selected', people }))
  assert.deepEqual(
    (await allow({ selectionMode: 'selected', people: ['speaker-1'] })).people,
    ['speaker-1']
  )
})
test('configured action providers receive only declared dependencies and return bounded options', async ({
  sails
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with(
    fixture()
  )
  const action = contract.resources.event.actionDefinitions.email
  const original = {
    build: sails.helpers.bridge.buildSailsWrapper,
    execute: sails.helpers.bridge.executeInContainer
  }
  let received
  let response = {
    options: [
      {
        value: 'speaker-1',
        label: 'Alex',
        description: 'alex@example.com',
        private: 'discard'
      }
    ]
  }
  sails.helpers.bridge.buildSailsWrapper = async (code) => code
  sails.helpers.bridge.executeInContainer = async (_, code) => {
    const output = await new Function('sails', `return(async()=>{${code}})()`)({
      helpers: {
        bridge: {
          people: {
            with: async (input) => {
              received = input
              return response
            }
          }
        }
      }
    })
    return { success: true, output: JSON.stringify(output) }
  }
  try {
    const result = await sails.helpers.bridge.searchActionOptions.with({
      containerName: 'test',
      action,
      fieldName: 'people',
      actor: { id: 'admin' },
      recordId: 'event-1',
      values: { audience: 'attendees', subject: 'private', helper: 'injected' },
      q: 'alex',
      selectedIds: []
    })
    assert.deepEqual(received, {
      actor: { id: 'admin' },
      recordId: 'event-1',
      values: { audience: 'attendees' },
      q: 'alex',
      selectedIds: []
    })
    assert.equal(result.options[0].private, undefined)
    for (const options of [
      [{ value: 'x', label: 'x'.repeat(201) }],
      [
        { value: 'x', label: 'X' },
        { value: 'x', label: 'Y' }
      ],
      Array(101).fill({ value: 'x', label: 'X' })
    ]) {
      response = { options }
      await assert.rejects(() =>
        sails.helpers.bridge.searchActionOptions.with({
          containerName: 'test',
          action,
          fieldName: 'people',
          actor: { id: 'admin' },
          recordId: 'event-1'
        })
      )
    }
  } finally {
    sails.helpers.bridge.buildSailsWrapper = original.build
    sails.helpers.bridge.executeInContainer = original.execute
  }
})
