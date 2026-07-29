const { test } = require('sounding')

const {
  buildSailsCompletionSource,
  collectSailsCompletionMetadata
} = require('../../../../api/lib/helm-completions')

function completionSailsFixture() {
  let getterRead = false
  const config = {
    custom: {
      publicName: 'Hagfish',
      secretToken: 'never-return-this-secret'
    },
    models: {
      migrate: 'safe'
    }
  }
  Object.defineProperty(config.custom, 'computedSecret', {
    enumerable: true,
    get() {
      getterRead = true
      return 'never-invoke-this-getter'
    }
  })

  const creatorModel = Object.create({
    identity: 'creator',
    globalId: 'Creator',
    attributes: {
      firstName: { type: 'string', required: true },
      team: { model: 'team' },
      invoices: { collection: 'invoice', via: 'creator' }
    }
  })

  const fakeSails = {
    models: {
      creator: creatorModel
    },
    helpers: {
      mail: {
        sendTemplate() {}
      },
      formatCurrency() {}
    },
    config
  }

  return {
    fakeSails,
    getterWasRead: () => getterRead
  }
}

test('Helm completion metadata contains names and types without reading values', ({
  expect
}) => {
  const fixture = completionSailsFixture()
  const metadata = collectSailsCompletionMetadata(fixture.fakeSails)
  const serialized = JSON.stringify(metadata)

  expect(metadata.truncated).toBe(false)
  expect(metadata.models[0]).toEqual({
    identity: 'creator',
    globalId: 'Creator',
    attributes: [
      {
        name: 'firstName',
        type: 'string',
        association: null
      },
      {
        name: 'invoices',
        type: 'collection:invoice',
        association: 'collection'
      },
      {
        name: 'team',
        type: 'model:team',
        association: 'model'
      }
    ]
  })
  expect(metadata.helpers).toEqual([
    { path: 'formatCurrency' },
    { path: 'mail.sendTemplate' }
  ])
  expect(
    metadata.config.find((entry) => entry.path === 'custom.secretToken')
  ).toEqual({
    path: 'custom.secretToken',
    type: 'string'
  })
  expect(
    metadata.config.find((entry) => entry.path === 'custom.computedSecret')
  ).toEqual({
    path: 'custom.computedSecret',
    type: 'undefined'
  })
  expect(fixture.getterWasRead()).toBe(false)
  expect(serialized.includes('never-return-this-secret')).toBe(false)
  expect(serialized.includes('never-invoke-this-getter')).toBe(false)
  expect(serialized.includes('Hagfish')).toBe(false)
  expect(serialized.includes('safe')).toBe(false)
})

test('container completion source uses the same secret-free collector', ({
  expect
}) => {
  const fixture = completionSailsFixture()
  const source = buildSailsCompletionSource()
  const metadata = Function('sails', source)(fixture.fakeSails)

  expect(metadata).toEqual(collectSailsCompletionMetadata(fixture.fakeSails))
  expect(JSON.stringify(metadata).includes('never-return-this-secret')).toBe(
    false
  )
})

test('Helm completion metadata is bounded for unusually large apps', ({
  expect
}) => {
  const models = {}
  for (let index = 0; index < 101; index++) {
    const identity = `model${String(index).padStart(3, '0')}`
    models[identity] = {
      identity,
      globalId: `Model${String(index).padStart(3, '0')}`,
      attributes: {}
    }
  }

  const metadata = collectSailsCompletionMetadata({
    models,
    helpers: {},
    config: {}
  })

  expect(metadata.models.length).toBe(100)
  expect(metadata.truncated).toBe(true)
})

test('Helm completion resolves Sails and Waterline contexts', async ({
  expect
}) => {
  const { helmCompletionResult } = await import(
    '../../../../assets/js/lib/helmCompletions.mjs'
  )
  const metadata = collectSailsCompletionMetadata(
    completionSailsFixture().fakeSails
  )
  const labelsFor = (source, explicit = false) =>
    helmCompletionResult(source, source.length, metadata, {
      explicit
    })?.options.map((option) => option.label) || []

  expect(labelsFor('Cre')).toContain('Creator')
  expect(labelsFor('Creator.fi')).toContain('find')
  expect(labelsFor('Creator.find().li')).toContain('limit')
  expect(labelsFor('Creator.find({ fir')).toContain('firstName')
  expect(labelsFor("Creator.find().select(['fir")).toContain('firstName')
  expect(labelsFor('Creator.attributes.te')).toContain('team')
  expect(labelsFor('sails.helpers.ma')).toContain('mail')
  expect(labelsFor('sails.helpers.mail.s')).toContain('sendTemplate')
  expect(labelsFor('sails.config.cu')).toContain('custom')
  expect(labelsFor('sails.config.custom.se')).toContain('secretToken')
  expect(labelsFor('sails.models.cre')).toContain('creator')
  expect(labelsFor('ordinaryLowercase')).toEqual([])
  expect(labelsFor('', true)).toContain('sails')
})
