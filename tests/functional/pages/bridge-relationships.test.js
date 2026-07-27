const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'Bridge searches and attaches relationships through bounded authorized endpoints',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bridge-relationship-management',
          name: 'Bridge relationship management'
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
    const courseId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80221'
    const lessonId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80222'
    let mutation

    const contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models: relationshipModels(),
      config: relationshipConfig({ attach: true, detach: true })
    })

    try {
      await sails.models.app.updateOne({ id: app.id }).set({
        status: 'running',
        containerName: 'bridge-relationship-management-web'
      })
      sails.helpers.bridge.introspectModels = async () => ({
        schemaVersion: contract.schemaVersion,
        discover: contract.discover,
        configured: contract.configured,
        models: contract.resources
      })
      sails.helpers.bridge.buildSailsWrapper = async (code) => code
      sails.helpers.bridge.executeInContainer = async (containerName, code) => {
        expect(containerName).toBe('bridge-relationship-management-web')
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
        if (code.includes('const where = definition.query')) {
          const definition = readEmbeddedValue(code, 'definition')
          expect(definition.page).toBe(2)
          expect(definition.query).toBe('deploy')
          expect(definition.limit).toBe(12)
          expect(definition.recordId).toBe(courseId)
          return successfulResult({
            options: [
              {
                id: lessonId,
                label: 'Deploy without drama',
                attached: false
              }
            ],
            page: 2,
            limit: 12,
            hasMore: false
          })
        }
        if (code.includes('const [parent, related] = await Promise.all')) {
          mutation = readEmbeddedValue(code, 'definition')
          return successfulResult({ success: true })
        }
        return failedResult('Unexpected Bridge relationship query.')
      }

      const browser = await withCsrfFromPage(
        request,
        '/projects/new',
        'genesisUser'
      )
      const optionsPath =
        `/api/v1/projects/${project.slug}/environments/${environment.slug}` +
        `/bridge/course/relationships/lessons/options` +
        `?surface=manage&recordId=${courseId}&q=deploy&page=2`
      const optionsResponse = await browser.request.get(optionsPath)

      expect(optionsResponse).toHaveStatus(200)
      expect(optionsResponse).toHaveJsonPath(
        'options.0.label',
        'Deploy without drama'
      )
      expect(optionsResponse).toHaveJsonPath('options.0.attached', false)
      expect(optionsResponse).toHaveJsonPath('hasMore', false)

      const mutationResponse = await browser.request.post(
        `/projects/${project.slug}/environments/${environment.slug}` +
          `/bridge/course/${courseId}/relationships/lessons/attach`,
        { relatedId: lessonId }
      )
      expect(mutationResponse).toHaveStatus(302)
      expect(mutation).toEqual({
        parentIdentity: 'course',
        parentPrimaryKey: 'id',
        parentId: courseId,
        alias: 'lessons',
        relatedIdentity: 'lesson',
        relatedPrimaryKey: 'id',
        relatedId: lessonId,
        operation: 'attach'
      })
    } finally {
      sails.helpers.bridge.introspectModels = originalIntrospectModels
      sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
      sails.helpers.bridge.executeInContainer = originalExecuteInContainer
    }
  }
)

test(
  'Bridge collection mutations fail closed without explicit config or update authorization',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bridge-relationship-denials',
          name: 'Bridge relationship denials'
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
    const courseId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80231'
    const lessonId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80232'
    let contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models: relationshipModels(),
      config: relationshipConfig({ attach: false, detach: false })
    })
    let allowUpdate = true
    let mutationCount = 0

    try {
      await sails.models.app.updateOne({ id: app.id }).set({
        status: 'running',
        containerName: 'bridge-relationship-denials-web'
      })
      sails.helpers.bridge.introspectModels = async () => ({
        schemaVersion: contract.schemaVersion,
        discover: contract.discover,
        configured: contract.configured,
        models: contract.resources
      })
      sails.helpers.bridge.buildSailsWrapper = async (code) => code
      sails.helpers.bridge.executeInContainer = async (containerName, code) => {
        expect(containerName).toBe('bridge-relationship-denials-web')
        if (code.includes('const decisions = Object.create(null);')) {
          const requests = readEmbeddedValue(code, 'requests')
          const decisions = {}
          for (const authorizationRequest of requests) {
            decisions[authorizationRequest.key] =
              decisions[authorizationRequest.key] || {}
            decisions[authorizationRequest.key][authorizationRequest.action] =
              authorizationRequest.action !== 'update' || allowUpdate
          }
          return successfulResult(decisions)
        }
        if (code.includes('const [parent, related] = await Promise.all')) {
          mutationCount += 1
          return successfulResult({ success: true })
        }
        return failedResult('Unexpected Bridge relationship query.')
      }

      const browser = await withCsrfFromPage(
        request,
        '/projects/new',
        'genesisUser'
      )
      const mutationPath =
        `/projects/${project.slug}/environments/${environment.slug}` +
        `/bridge/course/${courseId}/relationships/lessons/attach`

      const disabledResponse = await browser.request.post(mutationPath, {
        relatedId: lessonId
      })
      expect(disabledResponse).toHaveStatus(400)
      expect(disabledResponse).toHaveHeader('x-exit', 'badRequest')
      expect(mutationCount).toBe(0)

      contract = await sails.helpers.bridge.normalizeResourceContract.with({
        models: relationshipModels(),
        config: relationshipConfig({ attach: true, detach: true })
      })
      allowUpdate = false
      const deniedResponse = await browser.request.post(mutationPath, {
        relatedId: lessonId
      })
      expect(deniedResponse).toHaveStatus(400)
      expect(deniedResponse).toHaveHeader('x-exit', 'badRequest')
      expect(mutationCount).toBe(0)
    } finally {
      sails.helpers.bridge.introspectModels = originalIntrospectModels
      sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
      sails.helpers.bridge.executeInContainer = originalExecuteInContainer
    }
  }
)

function relationshipConfig({ attach, detach }) {
  return {
    schemaVersion: 1,
    resources: {
      course: {
        title: 'title',
        authorization: 'bridge.authorize',
        relationships: {
          lessons: {
            label: 'Lessons',
            fields: ['id', 'title'],
            search: ['title'],
            limit: 12,
            attach,
            detach
          }
        }
      },
      lesson: {
        title: 'title',
        search: ['title'],
        authorization: 'bridge.authorize'
      }
    }
  }
}

function relationshipModels() {
  return {
    course: {
      identity: 'course',
      globalId: 'Course',
      tableName: 'course',
      primaryKey: 'id',
      attributes: {
        id: { type: 'string', required: true, isUUID: true },
        title: { type: 'string', required: true }
      },
      associations: [
        {
          alias: 'lessons',
          type: 'collection',
          collection: 'lesson',
          via: 'course'
        }
      ]
    },
    lesson: {
      identity: 'lesson',
      globalId: 'Lesson',
      tableName: 'lesson',
      primaryKey: 'id',
      attributes: {
        id: { type: 'string', required: true, isUUID: true },
        title: { type: 'string', required: true },
        course: { type: 'string', model: 'course' }
      },
      associations: [
        {
          alias: 'course',
          type: 'model',
          model: 'course'
        }
      ]
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
