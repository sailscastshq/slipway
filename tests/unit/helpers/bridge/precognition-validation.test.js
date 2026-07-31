const { test } = require('sounding')

test('Bridge validates only the generated field being edited', async ({
  sails,
  expect
}) => {
  const resource = {
    identity: 'subscriber',
    primaryKey: 'id',
    create: ['name', 'email'],
    edit: ['name', 'email'],
    attributes: {
      id: { type: 'number' },
      name: { type: 'string', required: true, label: 'Name' },
      email: {
        type: 'string',
        required: true,
        isEmail: true,
        label: 'Email'
      }
    },
    associations: []
  }

  const values = await sails.helpers.bridge.allowResourceValues.with({
    resource,
    surface: 'create',
    values: { email: 'editor@example.com' },
    validateOnly: ['email']
  })

  expect(values).toEqual({ email: 'editor@example.com' })
})

test('Bridge runs target Waterline validation without mutating a record', async ({
  sails,
  expect
}) => {
  const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
  const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
  const executions = []
  const resource = {
    identity: 'subscriber',
    primaryKey: 'id',
    attributes: {
      email: { type: 'string', unique: true, label: 'Email' }
    },
    associations: []
  }

  try {
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (containerName, code) => {
      executions.push({ containerName, code })
      return {
        success: true,
        output: JSON.stringify({ fieldErrors: {} }),
        error: null,
        exitCode: 0
      }
    }

    const values = await sails.helpers.bridge.validateResourceValues.with({
      containerName: 'bridge-web',
      resource,
      values: { email: 'editor@example.com' }
    })

    expect(values).toEqual({ email: 'editor@example.com' })
    expect(executions.length).toBe(1)
    expect(executions[0].containerName).toBe('bridge-web')
    expect(executions[0].code).toContain('model.validate(field, value)')
    expect(executions[0].code).toContain('await model.findOne')
    expect(executions[0].code.includes('model.create')).toBe(false)
    expect(executions[0].code.includes('model.update')).toBe(false)
  } finally {
    sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
    sails.helpers.bridge.executeInContainer = originalExecuteInContainer
  }
})

test('Bridge returns target validation errors under stable generated field keys', async ({
  sails,
  expect
}) => {
  const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
  const originalExecuteInContainer = sails.helpers.bridge.executeInContainer

  try {
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async () => ({
      success: true,
      output: JSON.stringify({
        fieldErrors: { email: 'Email is already in use.' }
      }),
      error: null,
      exitCode: 0
    })

    let receivedError
    try {
      await sails.helpers.bridge.validateResourceValues.with({
        containerName: 'bridge-web',
        resource: {
          identity: 'subscriber',
          primaryKey: 'id',
          attributes: {
            email: { type: 'string', unique: true, label: 'Email' }
          },
          associations: []
        },
        values: { email: 'taken@example.com' }
      })
    } catch (error) {
      receivedError = error
    }

    expect(receivedError.code).toBe('BRIDGE_FIELD_INVALID')
    expect(receivedError.fieldErrors).toEqual({
      email: 'Email is already in use.'
    })
  } finally {
    sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
    sails.helpers.bridge.executeInContainer = originalExecuteInContainer
  }
})
