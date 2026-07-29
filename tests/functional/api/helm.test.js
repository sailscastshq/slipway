const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

const RESULT = {
  success: true,
  value: [{ id: 1 }],
  logs: ['querying'],
  output: 'querying\n[\n  {\n    "id": 1\n  }\n]',
  error: null,
  durationMs: 12,
  truncated: false,
  status: 'success',
  rowCount: 1,
  outputBytes: 36,
  logsPartial: false
}

const COMPLETIONS = {
  available: true,
  version: 1,
  models: [
    {
      identity: 'creator',
      globalId: 'Creator',
      attributes: [{ name: 'firstName', type: 'string', association: null }]
    }
  ],
  helpers: [{ path: 'mail.sendTemplate' }],
  config: [{ path: 'custom.appName', type: 'string' }]
}

test(
  'Bosun Helm exposes the shared structured execution result',
  {
    world: {
      name: 'configured-slipway'
    }
  },
  async ({ sails, request, expect }) => {
    const originalEvaluate = sails.helpers.helm.evaluate
    let invocation
    sails.helpers.helm.evaluate = async (
      source,
      sourceStartLine,
      sourceStartColumn
    ) => {
      invocation = { source, sourceStartLine, sourceStartColumn }
      return RESULT
    }

    try {
      const dashboard = await withCsrfFromPage(request, '/bosun', 'genesisUser')
      const response = await dashboard.request.post('/api/v1/bosun/eval', {
        executionId: 'a019d7ef-c88c-44b6-b88e-bb2d27e21f14',
        code: 'await User.find()',
        sourceStartLine: 7,
        sourceStartColumn: 3
      })

      expect(response).toHaveStatus(200)
      expect(invocation).toEqual({
        source: 'await User.find()',
        sourceStartLine: 7,
        sourceStartColumn: 3
      })
      expect(response).toHaveJsonPath('success', true)
      expect(response).toHaveJsonPath('value.0.id', 1)
      expect(response).toHaveJsonPath('logs.0', 'querying')
      expect(response).toHaveJsonPath('durationMs', 12)
      expect(response).toHaveJsonPath('truncated', false)
    } finally {
      sails.helpers.helm.evaluate = originalEvaluate
    }
  }
)

test(
  'project Helm exposes the same structured execution result',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'shared-helm-contract',
          name: 'Shared Helm Contract'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const originalExecute = sails.helpers.helm.executeInContainer
    const current = world.current
    let invocation

    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      containerName: 'shared-helm-contract-web'
    })
    sails.helpers.helm.executeInContainer = async (
      containerName,
      source,
      sourceStartLine,
      sourceStartColumn
    ) => {
      invocation = {
        containerName,
        source,
        sourceStartLine,
        sourceStartColumn
      }
      return RESULT
    }

    try {
      const projectSlug = current.projects.deploymentTarget.slug
      const environmentSlug = current.environments.production.slug
      const dashboard = await withCsrfFromPage(
        request,
        `/projects/${projectSlug}/environments/${environmentSlug}/helm`,
        'genesisUser'
      )
      const response = await dashboard.request.post(
        `/api/v1/projects/${projectSlug}/environments/${environmentSlug}/execute`,
        {
          code: 'await Creator.find()',
          executionId: '6e0f9e7a-0f32-4a57-b253-2f86276427bc',
          sourceStartLine: 11,
          sourceStartColumn: 5
        }
      )

      expect(response).toHaveStatus(200)
      expect(invocation).toEqual({
        containerName: 'shared-helm-contract-web',
        source: 'await Creator.find()',
        sourceStartLine: 11,
        sourceStartColumn: 5
      })
      expect(response).toHaveJsonPath('success', true)
      expect(response).toHaveJsonPath('value.0.id', 1)
      expect(response).toHaveJsonPath('logs.0', 'querying')
      expect(response).toHaveJsonPath('durationMs', 12)
      expect(response).toHaveJsonPath('truncated', false)
    } finally {
      sails.helpers.helm.executeInContainer = originalExecute
    }
  }
)

test(
  'Helm cancellation delegates with the current user and does not expose ownership',
  {
    world: {
      name: 'configured-slipway'
    }
  },
  async ({ sails, request, expect }) => {
    const originalCancel = sails.helpers.helm.cancelExecution
    const calls = []
    sails.helpers.helm.cancelExecution = (executionId, userId) => {
      calls.push({ executionId, userId })
      return true
    }

    try {
      const dashboard = await withCsrfFromPage(request, '/bosun', 'genesisUser')
      const response = await dashboard.request.post(
        '/api/v1/helm/executions/ab6e36f8-4700-45e8-961a-13380634764b/cancel'
      )

      expect(response).toHaveStatus(200)
      expect(response).toHaveJsonPath('cancelled', true)
      expect(calls.length).toBe(1)
      expect(calls[0].executionId).toBe('ab6e36f8-4700-45e8-961a-13380634764b')
      expect(Boolean(calls[0].userId)).toBe(true)
    } finally {
      sails.helpers.helm.cancelExecution = originalCancel
    }
  }
)

test(
  'Bosun Helm introspects its live Sails app without returning config values',
  {
    world: {
      name: 'configured-slipway'
    }
  },
  async ({ sails, request, expect }) => {
    const secret = 'helm-completion-value-must-stay-server-side'
    sails.config.custom.helmCompletionTestSecret = secret

    try {
      const response = await request
        .as('genesisUser')
        .get('/api/v1/bosun/helm/completions')

      expect(response).toHaveStatus(200)
      expect(response.header('cache-control')).toMatch('private')
      expect(response.header('cache-control')).toMatch('no-store')
      expect(response).toHaveJsonPath('available', true)
      expect(response).toHaveJsonPath('version', 1)
      const userModel = response.data.models.find(
        (model) => model.identity === 'user'
      )
      expect(userModel.globalId).toBe('User')
      expect(
        userModel.attributes.some((attribute) => attribute.name === 'email')
      ).toBe(true)
      expect(response.data.helpers.length > 0).toBe(true)
      expect(
        response.data.config.some(
          (entry) => entry.path === 'custom.helmCompletionTestSecret'
        )
      ).toBe(true)
      expect(JSON.stringify(response.data).includes(secret)).toBe(false)
    } finally {
      delete sails.config.custom.helmCompletionTestSecret
    }
  }
)

test(
  'project Helm completion metadata comes from the current running app',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'helm-completion-contract',
          name: 'Helm Completion Contract'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const originalGetCompletions = sails.helpers.helm.getCompletions
    let inspectedContainer

    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      containerName: 'helm-completion-contract-web'
    })
    sails.helpers.helm.getCompletions = async (containerName) => {
      inspectedContainer = containerName
      return COMPLETIONS
    }

    try {
      const projectSlug = current.projects.deploymentTarget.slug
      const environmentSlug = current.environments.production.slug
      const response = await request
        .as('genesisUser')
        .get(
          `/api/v1/projects/${projectSlug}/environments/${environmentSlug}/helm/completions`
        )

      expect(response).toHaveStatus(200)
      expect(response.header('cache-control')).toMatch('private')
      expect(response.header('cache-control')).toMatch('no-store')
      expect(inspectedContainer).toBe('helm-completion-contract-web')
      expect(response).toHaveJsonPath('available', true)
      expect(response).toHaveJsonPath('models.0.globalId', 'Creator')
      expect(response).toHaveJsonPath('models.0.attributes.0.name', 'firstName')
      expect(response).toHaveJsonPath('helpers.0.path', 'mail.sendTemplate')
    } finally {
      sails.helpers.helm.getCompletions = originalGetCompletions
    }
  }
)

test(
  'project Helm completion degrades to an empty contract when its app is unavailable',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'helm-completion-unavailable',
          name: 'Helm Completion Unavailable'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'stopped',
      containerName: ''
    })

    const response = await request
      .as('genesisUser')
      .get(
        `/api/v1/projects/${current.projects.deploymentTarget.slug}/environments/${current.environments.production.slug}/helm/completions`
      )

    expect(response).toHaveStatus(200)
    expect(response).toHaveJsonPath('available', false)
    expect(response).toHaveJsonPath('version', 1)
    expect(response.data.models).toEqual([])
    expect(response.data.helpers).toEqual([])
    expect(response.data.config).toEqual([])
  }
)
