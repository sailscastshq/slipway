const { test } = require('sounding')

function models(...names) {
  return Object.fromEntries(
    names.map((identity) => [
      identity,
      {
        identity,
        primaryKey: 'id',
        attributes: {
          id: { type: 'number', autoIncrement: true },
          title: { type: 'string' }
        }
      }
    ])
  )
}
const action = { scope: 'resource', helper: 'bridge.exportAttendees' }

test('Bridge keeps identifiers while deriving canonical URL slugs', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: models('conferenceevent'),
    config: {
      resources: {
        conferenceevent: {
          slug: 'event',
          actions: {
            exportAttendees: action,
            exportCSV: action,
            requestChanges: { ...action, slug: 'request-review' },
            update: false
          }
        }
      }
    }
  })
  const resource = contract.resources.conferenceevent
  expect(resource.identity).toBe('conferenceevent')
  expect(resource.slug).toBe('event')
  expect(resource.actionDefinitions.exportAttendees.slug).toBe(
    'export-attendees'
  )
  expect(resource.actionDefinitions.exportCSV.slug).toBe('export-csv')
  expect(resource.actionDefinitions.requestChanges.slug).toBe('request-review')
  expect(resource.actionDefinitions.exportAttendees.name).toBe(
    'exportAttendees'
  )
  expect(resource.actionDefinitions.exportAttendees.helper).toBe(
    'bridge.exportAttendees'
  )
  expect(resource.actions.update).toBe(false)
})

test('Bridge rejects invalid, reserved and ambiguous URL aliases', async ({
  sails,
  expect
}) => {
  for (const resources of [
    { conferenceevent: { slug: '../event' } },
    { conferenceevent: { slug: 'Event' } },
    { conferenceevent: { slug: '' } },
    { conferenceevent: { slug: 'launch' } },
    { conferenceevent: { slug: 'event' }, event: {} },
    { conferenceevent: { slug: 'entries' }, event: { slug: 'entries' } },
    {
      conferenceevent: {
        actions: { exportAttendees: { ...action, slug: 'create' } }
      }
    },
    {
      conferenceevent: {
        actions: {
          exportAttendees: { ...action, slug: 'export' },
          export: action
        }
      }
    },
    {
      conferenceevent: {
        actions: {
          exportAttendees: { ...action, slug: 'export' },
          export: true
        }
      }
    }
  ]) {
    let error
    try {
      await sails.helpers.bridge.normalizeResourceContract.with({
        models: models('conferenceevent', 'event'),
        config: { discover: false, resources }
      })
    } catch (caught) {
      error = caught
    }
    expect(Boolean(error)).toBe(true)
    expect(error.message).toContain('slug')
  }
})

test('Bridge resolves canonical and legacy paths before authorization without changing identifiers', async ({
  sails,
  expect
}) => {
  const original = { ...sails.helpers.bridge }
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: models('conferenceevent'),
    config: {
      resources: {
        conferenceevent: { slug: 'event', actions: { exportAttendees: action } }
      }
    }
  })
  const resource = contract.resources.conferenceevent
  const actions = []
  try {
    sails.helpers.bridge.introspectModels = async () => ({
      models: contract.resources
    })
    sails.helpers.bridge.authorizeResourceActions = {
      with: async ({ resources: input }) => {
        expect(input.resource.identity).toBe('conferenceevent')
        return { resource: input.resource }
      }
    }
    for (const modelIdentity of ['event', 'conferenceevent']) {
      for (const name of ['export-attendees', 'exportAttendees']) {
        const loaded = await sails.helpers.bridge.loadResource.with({
          containerName: 'test',
          environmentId: 1,
          modelIdentity,
          action: name,
          actor: {}
        })
        expect(loaded.resource.identity).toBe('conferenceevent')
        actions.push(loaded.actionDefinition.name)
      }
    }
    expect(actions).toEqual(Array(4).fill('exportAttendees'))
    resource.actions.exportAttendees = false
    let denied
    try {
      await sails.helpers.bridge.loadResource.with({
        containerName: 'test',
        environmentId: 1,
        modelIdentity: 'event',
        action: 'export-attendees',
        actor: {}
      })
    } catch (e) {
      denied = e
    }
    expect(Boolean(denied)).toBe(true)
  } finally {
    Object.assign(sails.helpers.bridge, original)
  }
})

test('Bridge direct upload verification uses the resolved model identity', async ({
  sails,
  expect
}) => {
  const original = { ...sails.helpers.bridge }
  const helper = (fn) => ({ with: fn })
  try {
    sails.helpers.bridge.resolveRequest = helper(async () => ({
      project: { id: 1 },
      environment: { id: 2 },
      app: { id: 3, containerName: 'test' },
      actor: {},
      actorId: '4'
    }))
    sails.helpers.bridge.loadResource = helper(async ({ modelIdentity }) => {
      expect(modelIdentity).toBe('event')
      return {
        resource: {
          identity: 'conferenceevent',
          create: ['cover'],
          attributes: {
            cover: {
              field: {
                upload: {
                  storage: 'bridge',
                  maxBytes: 1000,
                  accept: ['image/png']
                }
              }
            }
          }
        }
      }
    })
    sails.helpers.bridge.verifyDirectUploadIntent = helper(
      async ({ context }) => {
        expect(context.resource).toBe('conferenceevent')
        return {
          recordId: null,
          fileSize: 100,
          fileType: 'image/png',
          objectPath: 'cover.png',
          url: 'https://cdn.example.com/cover.png'
        }
      }
    )
    sails.helpers.bridge.getUploadStorageConfig = helper(async () => ({
      publicUrl: 'https://cdn.example.com'
    }))
    const session = await original.resolveDirectUploadSession.with({
      req: {},
      projectSlug: 'demo',
      modelIdentity: 'event',
      fieldName: 'cover',
      uploadIntent: 'signed-intent'
    })
    expect(session.loaded.resource.identity).toBe('conferenceevent')
  } finally {
    Object.assign(sails.helpers.bridge, original)
  }
})
