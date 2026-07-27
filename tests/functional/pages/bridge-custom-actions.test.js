const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'Bridge executes an authorized record action and records a sanitized audit event',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bridge-custom-action',
          name: 'Bridge custom action'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const user = current.users.genesisUser
    const originalIntrospectModels = sails.helpers.bridge.introspectModels
    const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
    const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
    const courseId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80241'
    let helperInputs
    let actionExecutionCount = 0
    let allowPublish = true
    let publishError = null

    const contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models: courseModels(),
      config: actionConfig()
    })
    const targetPublish = async (inputs) => {
      actionExecutionCount += 1
      helperInputs = inputs
      if (publishError) throw new Error(publishError)
      return {
        message: 'Course published for 12 students.',
        internalReceipt: 'must not enter Slipway audit details'
      }
    }
    targetPublish.with = targetPublish

    try {
      await sails.models.app.updateOne({ id: app.id }).set({
        status: 'running',
        containerName: 'bridge-custom-action-web'
      })
      sails.helpers.bridge.introspectModels = async () => ({
        schemaVersion: contract.schemaVersion,
        discover: contract.discover,
        configured: contract.configured,
        models: contract.resources
      })
      sails.helpers.bridge.buildSailsWrapper = async (code) => code
      sails.helpers.bridge.executeInContainer = async (containerName, code) => {
        expect(containerName).toBe('bridge-custom-action-web')

        if (code.includes('const decisions = Object.create(null);')) {
          const requests = readEmbeddedValue(code, 'requests')
          const scopedRecordId = readEmbeddedValue(code, 'recordId')
          expect(scopedRecordId).toBe(courseId)
          const decisions = {}
          for (const authorizationRequest of requests) {
            decisions[authorizationRequest.key] =
              decisions[authorizationRequest.key] || {}
            decisions[authorizationRequest.key][authorizationRequest.action] =
              authorizationRequest.action !== 'publish' || allowPublish
          }
          return successfulResult(decisions)
        }

        if (code.includes('const helperIdentity =')) {
          try {
            const run = new Function(
              'sails',
              `return (async () => {${code}})();`
            )
            const output = await run({
              helpers: {
                bridge: {
                  publishCourse: targetPublish
                }
              }
            })
            return successfulResult(output)
          } catch (error) {
            return failedResult(error.message)
          }
        }

        return failedResult('Unexpected Bridge action query.')
      }

      const browser = await withCsrfFromPage(
        request,
        '/projects/new',
        'genesisUser'
      )
      const actionPath =
        `/projects/${project.slug}/environments/${environment.slug}` +
        '/bridge/course/actions/publish'
      const response = await browser.request.post(actionPath, {
        recordId: courseId,
        values: {
          notifyStudents: true,
          note: 'Ready for production.'
        }
      })

      expect(response).toHaveStatus(302)
      expect(actionExecutionCount).toBe(1)
      expect(helperInputs.recordId).toBe(courseId)
      expect(helperInputs.values).toEqual({
        notifyStudents: true,
        note: 'Ready for production.'
      })
      expect(helperInputs.actor.email).toBe(user.email)
      expect(helperInputs.resource.identity).toBe('course')

      const auditLog = await sails.models.auditlog.findOne({
        action: 'bridge.action.succeeded',
        user: user.id,
        resourceId: courseId
      })
      expect(Boolean(auditLog)).toBe(true)
      expect(auditLog.resourceType).toBe('bridgeAction')
      expect(auditLog.resourceId).toBe(courseId)
      expect(auditLog.details.action).toBe('publish')
      expect(auditLog.details.scope).toBe('record')
      expect(auditLog.details.recordId).toBe(courseId)
      expect(auditLog.details.values).toBe(undefined)
      expect(auditLog.details.internalReceipt).toBe(undefined)

      allowPublish = false
      const denied = await browser.request.post(actionPath, {
        recordId: courseId,
        values: {
          notifyStudents: false,
          note: 'A denied attempt.'
        }
      })
      expect(denied).toHaveStatus(400)
      expect(denied).toHaveHeader('x-exit', 'badRequest')
      expect(actionExecutionCount).toBe(1)

      allowPublish = true
      publishError = 'Publishing provider unavailable.\nTry again shortly.'
      const failed = await browser.request.post(actionPath, {
        recordId: courseId,
        values: {
          notifyStudents: false,
          note: 'This submitted value must not enter the audit log.'
        }
      })
      expect(failed).toHaveStatus(400)
      expect(failed).toHaveHeader('x-exit', 'badRequest')
      expect(actionExecutionCount).toBe(2)

      const failureAudit = await sails.models.auditlog.findOne({
        action: 'bridge.action.failed',
        user: user.id,
        resourceId: courseId
      })
      expect(Boolean(failureAudit)).toBe(true)
      expect(failureAudit.details.error).toBe(
        'Publishing provider unavailable. Try again shortly.'
      )
      expect(failureAudit.details.values).toBe(undefined)
      expect(failureAudit.details.note).toBe(undefined)
    } finally {
      sails.helpers.bridge.introspectModels = originalIntrospectModels
      sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
      sails.helpers.bridge.executeInContainer = originalExecuteInContainer
    }
  }
)

test(
  'Bridge rejects invalid and oversized custom action payloads before helper execution',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bridge-custom-action-denials',
          name: 'Bridge custom action denials'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const originalIntrospectModels = sails.helpers.bridge.introspectModels
    const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
    const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
    let actionExecutionCount = 0

    const contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models: courseModels(),
      config: actionConfig()
    })

    try {
      await sails.models.app.updateOne({ id: app.id }).set({
        status: 'running',
        containerName: 'bridge-custom-action-denials-web'
      })
      sails.helpers.bridge.introspectModels = async () => ({
        schemaVersion: contract.schemaVersion,
        discover: contract.discover,
        configured: contract.configured,
        models: contract.resources
      })
      sails.helpers.bridge.buildSailsWrapper = async (code) => code
      sails.helpers.bridge.executeInContainer = async (containerName, code) => {
        expect(containerName).toBe('bridge-custom-action-denials-web')
        if (code.includes('const decisions = Object.create(null);')) {
          const requests = readEmbeddedValue(code, 'requests')
          const decisions = {}
          for (const authorizationRequest of requests) {
            decisions[authorizationRequest.key] =
              decisions[authorizationRequest.key] || {}
            decisions[authorizationRequest.key][
              authorizationRequest.action
            ] = true
          }
          return successfulResult(decisions)
        }
        actionExecutionCount += 1
        return successfulResult({})
      }

      const browser = await withCsrfFromPage(
        request,
        '/projects/new',
        'genesisUser'
      )
      const basePath =
        `/projects/${project.slug}/environments/${environment.slug}` +
        '/bridge/course/actions'

      const invalidFields = await browser.request.post(`${basePath}/publish`, {
        recordId: '018f2a5c-7b34-7f8a-9c12-4a73b9d80242',
        values: {
          note: 'x',
          injected: 'not allowed'
        }
      })
      expect(invalidFields).toHaveStatus(400)

      const oversizedBulk = await browser.request.post(
        `${basePath}/regenerateLicenses`,
        {
          recordIds: Array.from({ length: 101 }, (_, index) => index + 1),
          values: {}
        }
      )
      expect(oversizedBulk).toHaveStatus(400)

      const validBulk = await browser.request.post(
        `${basePath}/regenerateLicenses`,
        {
          recordIds: [
            '018f2a5c-7b34-7f8a-9c12-4a73b9d80243',
            '018f2a5c-7b34-7f8a-9c12-4a73b9d80244'
          ],
          values: {}
        }
      )
      expect(validBulk).toHaveStatus(302)
      expect(actionExecutionCount).toBe(1)
    } finally {
      sails.helpers.bridge.introspectModels = originalIntrospectModels
      sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
      sails.helpers.bridge.executeInContainer = originalExecuteInContainer
    }
  }
)

function actionConfig() {
  return {
    resources: {
      course: {
        authorization: 'bridge.authorize',
        actions: {
          publish: {
            scope: 'record',
            helper: 'bridge.publishCourse',
            label: 'Publish course',
            success: 'Course published.',
            fields: {
              notifyStudents: {
                type: 'boolean',
                default: true
              },
              note: {
                type: 'textarea',
                required: true,
                minLength: 3
              }
            }
          },
          regenerateLicenses: {
            scope: 'bulk',
            helper: 'bridge.regenerateLicenses'
          }
        }
      }
    }
  }
}

function courseModels() {
  return {
    course: {
      identity: 'course',
      globalId: 'Course',
      tableName: 'courses',
      primaryKey: 'id',
      attributes: {
        id: { type: 'string', required: true, isUUID: true },
        title: { type: 'string', required: true }
      },
      associations: []
    }
  }
}

function readEmbeddedValue(code, name) {
  const match = code.match(new RegExp(`const ${name} = (.*);`))
  if (!match) throw new Error(`Missing ${name} declaration in Bridge query.`)
  return JSON.parse(match[1])
}

function successfulResult(output) {
  return {
    success: true,
    output: JSON.stringify(output),
    error: null,
    exitCode: 0
  }
}

function failedResult(error) {
  return {
    success: false,
    output: '',
    error,
    exitCode: 1
  }
}
