const { test } = require('sounding')

function metadata() {
  return {
    event: {
      identity: 'event',
      primaryKey: 'id',
      attributes: {
        id: { type: 'number' },
        title: { type: 'string' },
        speaker: { model: 'speaker' }
      },
      associations: [{ alias: 'speaker', type: 'model', model: 'speaker' }]
    },
    speaker: {
      identity: 'speaker',
      primaryKey: 'id',
      attributes: {
        id: { type: 'number' },
        name: { type: 'string' },
        email: { type: 'string' },
        company: { type: 'string' },
        score: { type: 'number' },
        active: { type: 'boolean' },
        secret: { type: 'string' },
        protected: { type: 'string', protect: true },
        encrypted: { type: 'string', encrypt: true },
        payload: { type: 'json' }
      },
      associations: []
    }
  }
}
function config(description) {
  return {
    resources: {
      event: {
        fields: {
          speaker: {
            relation: {
              ...(description === undefined ? {} : { description }),
              where: { active: true }
            }
          }
        }
      },
      speaker: {
        title: 'name',
        fields: { company: { visibility: { show: false } } }
      }
    }
  }
}

test('Bridge descriptions require explicitly visible non-sensitive scalar fields', async ({
  sails,
  expect
}) => {
  const normalize = (description) =>
    sails.helpers.bridge.normalizeResourceContract.with({
      models: metadata(),
      config: config(description)
    })
  expect(
    (await normalize()).resources.event.relationships.speaker.description
  ).toBe(undefined)
  const contract = await normalize(['email', 'email', 'score', 'active'])
  expect(contract.resources.event.relationships.speaker.description).toEqual([
    'email',
    'score',
    'active'
  ])
  for (const invalid of [
    'email',
    ['company'],
    ['secret'],
    ['protected'],
    ['encrypted'],
    ['payload'],
    ['missing'],
    [4]
  ]) {
    let error
    try {
      await normalize(invalid)
    } catch (cause) {
      error = cause
    }
    expect(Boolean(error)).toBe(true)
    expect(error.message).toContain('description')
  }
})

test('Bridge initial and searched descriptions preserve same-name IDs and scope', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: metadata(),
    config: config(['email', 'score', 'active'])
  })
  const records = [
    {
      id: 1,
      name: 'Alex Kim',
      email: 'alex@north.example',
      score: 0,
      active: true
    },
    {
      id: 2,
      name: 'Alex Kim',
      email: 'alex@south.example',
      score: null,
      active: true
    },
    { id: 3, name: 'Alex Kim', email: 'private@outside.example', active: false }
  ]
  const originalWrapper = sails.helpers.bridge.buildSailsWrapper
  const originalExecute = sails.helpers.bridge.executeInContainer
  const selections = []
  const query = (where, limit, skip = 0) => {
    const matches = (record, filter) =>
      filter.and
        ? filter.and.every((item) => matches(record, item))
        : Object.entries(filter).every(
            ([field, value]) => record[field] === value
          )
    const rows = records
      .filter((record) => matches(record, where))
      .slice(skip, skip + limit)
    return {
      select: async (fields) => {
        selections.push(fields)
        expect(fields.includes('secret')).toBe(false)
        return rows.map((row) =>
          Object.fromEntries(fields.map((field) => [field, row[field]]))
        )
      }
    }
  }
  try {
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (_name, code) => {
      const model = {
        find: ({ where, limit, skip }) => query(where, limit, skip),
        findOne: (where) => ({
          select: async (fields) => (await query(where, 1).select(fields))[0]
        })
      }
      const run = new Function('sails', `return (async () => {${code}})();`)
      return {
        success: true,
        output: JSON.stringify(await run({ models: { speaker: model } }))
      }
    }
    const args = {
      containerName: 'synthetic-only',
      resources: contract.resources,
      resource: contract.resources.event
    }
    args.resource.relationships.speaker.limit = 1
    const selected = await sails.helpers.bridge.loadAssociationOptions.with({
      ...args,
      surface: 'edit',
      values: { speaker: 2 }
    })
    expect(selected.speaker.map((option) => option.id)).toEqual([2, 1])
    expect(selected.speaker[0].description).toBe('alex@south.example · true')
    args.resource.relationships.speaker.limit = 20
    const initial = await sails.helpers.bridge.loadAssociationOptions.with({
      ...args,
      surface: 'edit',
      values: { speaker: 3 }
    })
    expect(initial.speaker.map((option) => option.id)).toEqual([3, 1, 2])
    expect(initial.speaker[0].outOfScope).toBe(true)
    expect(initial.speaker[0].description).toBe(undefined)
    expect(
      selections.some(
        (fields) => JSON.stringify(fields) === JSON.stringify(['id', 'name'])
      )
    ).toBe(true)
    expect(initial.speaker[1].description).toBe('alex@north.example · 0 · true')
    expect(initial.speaker[2].description).toBe('alex@south.example · true')
    const searched = await sails.helpers.bridge.searchRelationshipOptions.with({
      ...args,
      relationshipAlias: 'speaker'
    })
    expect(searched.options.map((option) => option.id)).toEqual([1, 2])
    expect(searched.options.map((option) => option.label)).toEqual([
      'Alex Kim',
      'Alex Kim'
    ])
    expect(searched.options[1].description).toBe('alex@south.example · true')
    args.resource.relationships.speaker.limit = 1
    const secondPage =
      await sails.helpers.bridge.searchRelationshipOptions.with({
        ...args,
        relationshipAlias: 'speaker',
        page: 2
      })
    expect(secondPage.page).toBe(2)
    expect(secondPage.options[0].id).toBe(2)
    expect(secondPage.options[0].description).toBe('alex@south.example · true')
    args.resource.relationships.speaker.limit = 20
    delete args.resource.relationships.speaker.description
    const plain = await sails.helpers.bridge.searchRelationshipOptions.with({
      ...args,
      relationshipAlias: 'speaker'
    })
    expect(plain.options[0].description).toBe(undefined)
  } finally {
    sails.helpers.bridge.buildSailsWrapper = originalWrapper
    sails.helpers.bridge.executeInContainer = originalExecute
  }
})
