const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

const RESULT = {
  success: true,
  value: [{ id: 1 }],
  logs: ['querying'],
  output: 'querying\n[\n  {\n    "id": 1\n  }\n]',
  error: null,
  durationMs: 12,
  truncated: false
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
