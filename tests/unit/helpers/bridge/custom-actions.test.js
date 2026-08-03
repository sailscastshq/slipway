const { test } = require('sounding')

test('Bridge normalizes resource, record, and bulk custom actions', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: courseMetadata(),
    config: actionConfig()
  })
  const course = contract.resources.course

  expect(course.actions.publish).toBe(true)
  expect(course.actions.regenerateLicenses).toBe(true)
  expect(course.actionDefinitions.publish).toEqual({
    name: 'publish',
    scope: 'record',
    helper: 'bridge.publishCourse',
    label: 'Publish course',
    description: 'Make this course visible to students.',
    confirm: 'Publish this course now?',
    success: 'Course published.',
    destructive: false,
    fields: {
      notifyStudents: {
        type: 'boolean',
        label: 'Notify Students',
        required: false,
        field: {
          type: 'boolean',
          default: true
        }
      },
      note: {
        type: 'string',
        label: 'Release note',
        required: true,
        minLength: 3,
        maxLength: 280,
        field: {
          type: 'textarea',
          help: 'Shown in the release email.'
        }
      }
    }
  })
  expect(course.actionDefinitions.regenerateLicenses.scope).toBe('bulk')
  expect(course.actionDefinitions.regenerateLicenses.destructive).toBe(true)
  expect(course.actionDefinitions.regenerateLicenses.confirm).toContain(
    'may not be reversible'
  )
})

test('Bridge fails closed for malformed custom action definitions', async ({
  sails,
  expect
}) => {
  const invalidConfigs = [
    {
      publish: {
        scope: 'row',
        helper: 'bridge.publishCourse'
      }
    },
    {
      publish: {
        scope: 'record',
        helper: 'bridge.__proto__.publish'
      }
    },
    {
      update: {
        scope: 'record',
        helper: 'bridge.updateCourse'
      }
    },
    {
      publish: {
        scope: 'record',
        helper: 'bridge.publishCourse',
        fields: {
          audience: {
            type: 'select'
          }
        }
      }
    },
    {
      publish: {
        scope: 'record',
        helper: 'bridge.publishCourse',
        fields: {
          audience: {
            type: 'select',
            default: 'everyone',
            options: ['customers']
          }
        }
      }
    }
  ]

  for (const actions of invalidConfigs) {
    let receivedError
    try {
      await sails.helpers.bridge.normalizeResourceContract.with({
        models: courseMetadata(),
        config: {
          resources: {
            course: { actions }
          }
        }
      })
    } catch (error) {
      receivedError = error
    }
    expect(Boolean(receivedError)).toBe(true)
  }
})

test('Bridge validates action fields and applies configured defaults', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: courseMetadata(),
    config: actionConfig()
  })
  const course = contract.resources.course
  const action = course.actionDefinitions.publish

  const values = await sails.helpers.bridge.allowActionValues.with({
    resource: course,
    action,
    values: {
      note: 'Ready for production.'
    }
  })
  expect(values).toEqual({
    notifyStudents: true,
    note: 'Ready for production.'
  })

  let invalidError
  try {
    await sails.helpers.bridge.allowActionValues.with({
      resource: course,
      action,
      values: {
        note: 'x',
        injected: 'must not reach the target helper'
      }
    })
  } catch (error) {
    invalidError = error
  }
  expect(invalidError.code).toBe('BRIDGE_FIELD_NOT_ALLOWED')
  expect(invalidError.fields).toEqual(['injected'])
})

test('Bridge removes denied custom actions from the effective UI contract', async ({
  sails,
  expect
}) => {
  const config = actionConfig()
  config.resources.course.authorization = 'bridge.authorize'
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: courseMetadata(),
    config
  })
  const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
  const originalExecuteInContainer = sails.helpers.bridge.executeInContainer

  try {
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (containerName, code) => {
      expect(containerName).toBe('bridge-app-web')
      const requests = readEmbeddedValue(code, 'requests')
      const decisions = {}
      for (const request of requests) {
        decisions[request.key] = decisions[request.key] || {}
        decisions[request.key][request.action] = request.action !== 'publish'
      }
      return successfulResult(decisions)
    }

    const effective = await sails.helpers.bridge.authorizeResourceActions.with({
      containerName: 'bridge-app-web',
      resources: contract.resources,
      actor: {
        id: '7',
        email: 'editor@example.com'
      },
      recordId: 42
    })
    expect(effective.course.actions.publish).toBe(false)
    expect(effective.course.actionDefinitions.publish).toBe(undefined)
    expect(effective.course.actionDefinitions.regenerateLicenses.scope).toBe(
      'bulk'
    )
  } finally {
    sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
    sails.helpers.bridge.executeInContainer = originalExecuteInContainer
  }
})

test('Bridge custom actions expose only bounded helper feedback', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: courseMetadata(),
    config: actionConfig()
  })
  const course = contract.resources.course
  const action = course.actionDefinitions.publish
  const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
  const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
  const targetPublish = async (inputs) => {
    expect(inputs.recordId).toBe(42)
    expect(inputs.values).toEqual({
      notifyStudents: true,
      note: 'Ready.'
    })
    expect(inputs.resource.identity).toBe('course')
    return {
      message: `  Published ${inputs.recordId}.  `,
      secret: 'must not leave the target app'
    }
  }
  targetPublish.with = targetPublish

  try {
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (containerName, code) => {
      expect(containerName).toBe('bridge-app-web')
      const run = new Function('sails', `return (async () => {${code}})();`)
      const output = await run({
        helpers: {
          bridge: {
            publishCourse: targetPublish
          }
        }
      })
      return successfulResult(output)
    }

    const result = await sails.helpers.bridge.executeCustomAction.with({
      containerName: 'bridge-app-web',
      resource: course,
      action,
      actor: {
        id: '7',
        email: 'editor@example.com'
      },
      values: {
        notifyStudents: true,
        note: 'Ready.'
      },
      recordId: 42
    })
    expect(result).toEqual({ message: 'Published 42.' })
  } finally {
    sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
    sails.helpers.bridge.executeInContainer = originalExecuteInContainer
  }
})

test('Bridge invokes an allowlisted domain helper with named values and maps its one-time result', async ({
  sails,
  expect
}) => {
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models: courseMetadata(),
    config: {
      resources: {
        course: {
          actions: {
            issueLicense: {
              scope: 'resource',
              helper: {
                identity: 'license.createLicense',
                inputs: 'values',
                result: {
                  message:
                    'License issued for {{ email }}. Copy this key now: {{key}}'
                }
              },
              fields: {
                email: { type: 'email', required: true },
                maxUses: { type: 'number', required: true }
              }
            }
          }
        }
      }
    }
  })
  const action = contract.resources.course.actionDefinitions.issueLicense
  expect(action.helper).toBe('license.createLicense')
  expect(action.invocation).toEqual({
    inputs: 'values',
    context: [],
    result: {
      message: 'License issued for {{ email }}. Copy this key now: {{key}}'
    }
  })

  const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
  const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
  let helperInputs
  let shouldFail = false
  const createLicense = async (inputs) => {
    helperInputs = inputs
    if (shouldFail) {
      throw new Error(
        'provider failure containing plaintext secret sk_live_nope'
      )
    }
    return {
      email: inputs.email,
      key: 'license-key-shown-once',
      internalReceipt: 'must not leave the target app'
    }
  }
  createLicense.with = createLicense

  try {
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (containerName, code) => {
      expect(containerName).toBe('bridge-app-web')
      try {
        const run = new Function('sails', `return (async () => {${code}})();`)
        const output = await run({
          helpers: {
            license: { createLicense }
          }
        })
        return successfulResult(output)
      } catch (error) {
        return {
          success: false,
          output: '',
          error: error.message,
          exitCode: 1
        }
      }
    }

    const result = await sails.helpers.bridge.executeCustomAction.with({
      containerName: 'bridge-app-web',
      resource: contract.resources.course,
      action,
      actor: { id: '7', email: 'admin@example.com' },
      values: {
        email: 'customer@example.com',
        maxUses: 2
      }
    })
    expect(helperInputs).toEqual({
      email: 'customer@example.com',
      maxUses: 2
    })
    expect(result).toEqual({
      message:
        'License issued for customer@example.com. Copy this key now: license-key-shown-once'
    })

    shouldFail = true
    let normalizedError
    try {
      await sails.helpers.bridge.executeCustomAction.with({
        containerName: 'bridge-app-web',
        resource: contract.resources.course,
        action,
        actor: { id: '7', email: 'admin@example.com' },
        values: {
          email: 'customer@example.com',
          maxUses: 2
        }
      })
    } catch (error) {
      normalizedError = error
    }
    expect(normalizedError.message).toBe('Issue License failed.')
    expect(normalizedError.message.includes('sk_live_nope')).toBe(false)
  } finally {
    sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
    sails.helpers.bridge.executeInContainer = originalExecuteInContainer
  }
})

function actionConfig() {
  return {
    resources: {
      course: {
        actions: {
          publish: {
            scope: 'record',
            helper: 'bridge.publishCourse',
            label: 'Publish course',
            description: 'Make this course visible to students.',
            confirm: 'Publish this course now?',
            success: 'Course published.',
            fields: {
              notifyStudents: {
                type: 'boolean',
                default: true
              },
              note: {
                type: 'textarea',
                label: 'Release note',
                help: 'Shown in the release email.',
                required: true,
                minLength: 3,
                maxLength: 280
              }
            }
          },
          regenerateLicenses: {
            scope: 'bulk',
            helper: 'bridge.regenerateLicenses',
            destructive: true
          }
        }
      }
    }
  }
}

function courseMetadata() {
  return {
    course: {
      identity: 'course',
      globalId: 'Course',
      tableName: 'courses',
      primaryKey: 'id',
      attributes: {
        id: { type: 'number', autoIncrement: true },
        title: { type: 'string', required: true },
        published: { type: 'boolean', defaultsTo: false }
      },
      associations: []
    }
  }
}

function successfulResult(output) {
  return {
    success: true,
    output: JSON.stringify(output),
    error: null,
    exitCode: 0
  }
}

function readEmbeddedValue(code, name) {
  const match = code.match(new RegExp(`const ${name} = (.*);`))
  if (!match) throw new Error(`Missing ${name} declaration in Bridge query.`)
  return JSON.parse(match[1])
}
