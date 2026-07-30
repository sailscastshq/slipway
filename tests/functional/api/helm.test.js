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
  logsPartial: false,
  inspections: [
    {
      id: 0,
      line: 7,
      column: 25,
      values: [{ value: 1, preview: '1', truncated: false }],
      omittedCount: 0
    }
  ],
  queryTrace: {
    enabled: true,
    entries: [
      {
        kind: 'waterline',
        model: 'creator',
        datastore: 'default',
        method: 'find',
        durationMs: 2,
        status: 'success',
        criteria: { where: { id: '[value]' } }
      }
    ],
    omittedCount: 0
  }
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
      expect(response).toHaveJsonPath('inspections.0.line', 7)
      expect(response).toHaveJsonPath(
        'queryTrace.entries.0.criteria.where.id',
        '[value]'
      )
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
      expect(response).toHaveJsonPath('inspections.0.values.0.preview', '1')
      expect(response).toHaveJsonPath('queryTrace.entries.0.method', 'find')

      const history = await sails.models.helmhistoryentry.findOne({
        user: current.users.genesisUser.id,
        project: current.projects.deploymentTarget.id,
        environment: current.environments.production.id
      })
      expect(history.source).toBe('await Creator.find()')
      expect(history.status).toBe('success')
      expect(history.durationMs).toBe(12)
      expect(history.target).toBe(current.apps.web.slug)
      expect(JSON.stringify(history).includes('querying')).toBe(false)
      expect(JSON.stringify(history).includes('"value"')).toBe(false)

      const audit = await sails.models.auditlog.findOne({
        action: 'helm.executed',
        resourceId: String(current.apps.web.id)
      })
      expect(audit.details.status).toBe('success')
      expect(audit.details.sourceBytes).toBe(
        Buffer.byteLength('await Creator.find()')
      )
      expect(JSON.stringify(audit).includes('await Creator.find()')).toBe(false)
      expect(JSON.stringify(audit).includes('querying')).toBe(false)
    } finally {
      sails.helpers.helm.executeInContainer = originalExecute
    }
  }
)

test(
  'production Helm requires a source-and-deployment-bound single-use write arm',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'production-helm-write-arm',
          name: 'Production Helm Write Arm'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const app = current.apps.web
    const originalExecute = sails.helpers.helm.executeInContainer
    let executions = 0

    await sails.models.app.updateOne({ id: app.id }).set({
      status: 'running',
      containerName: 'production-helm-write-arm-web'
    })
    sails.helpers.helm.executeInContainer = async () => {
      executions += 1
      return RESULT
    }

    try {
      const helmPath = `/projects/${project.slug}/environments/${environment.slug}/helm`
      const executePath = `/api/v1/projects/${project.slug}/environments/${environment.slug}/execute`
      const armPath = `/api/v1/projects/${project.slug}/environments/${environment.slug}/helm/arm-writes`
      const inspectPath = `/api/v1/projects/${project.slug}/environments/${environment.slug}/helm/inspect-source`
      const browser = await withCsrfFromPage(request, helmPath, 'genesisUser')
      const source =
        "await Creator.updateOne({ id: 1 }).set({ email: 'new@example.com' })"

      const inspection = await browser.request.post(inspectPath, {
        code: source
      })
      expect(inspection).toHaveStatus(200)
      expect(inspection).toHaveJsonPath('requiresWriteArm', true)
      expect(inspection).toHaveJsonPath('classification.mutating', true)

      const blocked = await browser.request.post(executePath, {
        code: source,
        executionId: '2667db5d-46af-4762-80aa-7c3f89704c9f'
      })
      expect(blocked).toHaveStatus(409)
      expect(blocked).toHaveJsonPath('code', 'HELM_WRITES_NOT_ARMED')
      expect(blocked).toHaveJsonPath('classification.mutating', true)
      expect(executions).toBe(0)

      const armed = await browser.request.post(armPath, { code: source })
      expect(armed).toHaveStatus(201)
      expect(armed.data.token.length > 30).toBe(true)
      expect(armed.data.sourceHash.length).toBe(64)
      expect(armed).toHaveJsonPath('target.environment.isProduction', true)

      const executed = await browser.request.post(executePath, {
        code: source,
        writeArmToken: armed.data.token,
        executionId: '47c4b4fe-d30d-4649-8a86-d12a63c716f7'
      })
      expect(executed).toHaveStatus(200)
      expect(executions).toBe(1)

      const reused = await browser.request.post(executePath, {
        code: source,
        writeArmToken: armed.data.token,
        executionId: '873cb28a-a1bb-45f7-a73c-9090283d6992'
      })
      expect(reused).toHaveStatus(409)
      expect(executions).toBe(1)

      const executionAudit = await sails.models.auditlog.findOne({
        action: 'helm.executed',
        resourceId: String(app.id)
      })
      expect(executionAudit.details.sourceHash).toBe(armed.data.sourceHash)
      expect(executionAudit.details.writeArmed).toBe(true)
      expect(executionAudit.details.outputBytes).toBe(RESULT.outputBytes)
      expect(executionAudit.details.environment.isProduction).toBe(true)
      expect(JSON.stringify(executionAudit).includes(source)).toBe(false)
      expect(JSON.stringify(executionAudit).includes('querying')).toBe(false)

      const [blockedAudit] = await sails.models.auditlog
        .find({
          action: 'helm.execution.blocked',
          resourceId: String(app.id)
        })
        .sort('createdAt ASC')
        .limit(1)
      expect(blockedAudit.details.outputBytes).toBe(0)
      expect(JSON.stringify(blockedAudit).includes(source)).toBe(false)
    } finally {
      sails.helpers.helm.executeInContainer = originalExecute
    }
  }
)

test(
  'project Helm history is durable, searchable, scoped, and preserves pins when cleared',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'durable-helm-history',
          name: 'Durable Helm History'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const app = current.apps.web
    const user = current.users.genesisUser
    const otherUser = await world.create('user').with({
      fullName: 'Other Builder',
      email: 'other-helm-builder@example.com',
      team: current.teams.genesisTeam.id,
      teamRole: 'member'
    })
    const common = {
      status: 'success',
      durationMs: 8,
      executedAt: Date.now(),
      target: app.slug,
      team: current.teams.genesisTeam.id,
      project: project.id,
      environment: environment.id,
      app: app.id
    }
    const pinned = await sails.models.helmhistoryentry
      .create({
        ...common,
        source: 'await Creator.find({ pinned: true })',
        pinned: true,
        user: user.id
      })
      .fetch()
    await sails.models.helmhistoryentry.create({
      ...common,
      source: 'await Creator.find({ recent: true })',
      user: user.id
    })
    await sails.models.helmhistoryentry.create({
      ...common,
      source: 'await Creator.find({ private: true })',
      user: otherUser.id
    })

    const helmPath = `/projects/${project.slug}/environments/${environment.slug}/helm`
    const apiPath = `/api/v1/projects/${project.slug}/environments/${environment.slug}/helm/history`
    const browser = await withCsrfFromPage(request, helmPath, 'genesisUser')

    const search = await browser.request.get(`${apiPath}?q=pinned`)
    expect(search).toHaveStatus(200)
    expect(search.data.entries.length).toBe(1)
    expect(search).toHaveJsonPath('entries.0.id', pinned.id)
    expect(search.data.entries[0].source.includes('private')).toBe(false)
    expect(search.header('cache-control')).toMatch('private')
    expect(search.header('cache-control')).toMatch('no-store')

    const unpin = await browser.request.patch(`${apiPath}/${pinned.id}`, {
      pinned: false
    })
    expect(unpin).toHaveStatus(200)
    expect(unpin).toHaveJsonPath('entry.pinned', false)
    await browser.request.patch(`${apiPath}/${pinned.id}`, { pinned: true })

    const cleared = await browser.request.delete(apiPath, {})
    expect(cleared).toHaveStatus(200)
    expect(cleared).toHaveJsonPath('deletedCount', 1)
    expect(
      Boolean(
        await sails.models.helmhistoryentry.findOne({
          id: pinned.id,
          pinned: true
        })
      )
    ).toBe(true)
    expect(
      Boolean(
        await sails.models.helmhistoryentry.findOne({
          user: otherUser.id
        })
      )
    ).toBe(true)
    expect(
      Boolean(
        await sails.models.auditlog.findOne({
          action: 'helm.history.cleared',
          user: user.id
        })
      )
    ).toBe(true)
  }
)

test(
  'Helm snippets keep personal source private and shared source owner-managed',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'helm-snippet-permissions',
          name: 'Helm Snippet Permissions'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const helmPath = `/projects/${project.slug}/environments/${environment.slug}/helm`
    const apiPath = `/api/v1/projects/${project.slug}/environments/${environment.slug}/helm/snippets`
    const ownerBrowser = await withCsrfFromPage(
      request,
      helmPath,
      'genesisUser'
    )
    const personal = await ownerBrowser.request.post(apiPath, {
      name: 'My creators',
      source: 'await Creator.find().limit(10)',
      scope: 'personal'
    })
    const shared = await ownerBrowser.request.post(apiPath, {
      name: 'Active creators',
      source: 'await Creator.find({ isActive: true })',
      scope: 'project'
    })

    expect(personal).toHaveStatus(201)
    expect(personal).toHaveJsonPath('snippet.scope', 'personal')
    expect(shared).toHaveStatus(201)
    expect(shared).toHaveJsonPath('snippet.canManage', true)

    const member = await world.create('user').with({
      fullName: 'Snippet Reader',
      email: 'snippet-reader@example.com',
      team: current.teams.genesisTeam.id,
      teamRole: 'member'
    })
    const memberBrowser = await withCsrfFromPage(request, helmPath, member)
    const visible = await memberBrowser.request.get(apiPath)
    expect(visible).toHaveStatus(200)
    expect(visible.data.snippets.length).toBe(1)
    expect(visible).toHaveJsonPath('snippets.0.name', 'Active creators')
    expect(visible).toHaveJsonPath('snippets.0.canManage', false)

    const forbidden = await memberBrowser.request.patch(
      `${apiPath}/${shared.data.snippet.id}`,
      { name: 'Overwritten by somebody else' }
    )
    expect(forbidden).toHaveStatus(403)

    const updated = await ownerBrowser.request.patch(
      `${apiPath}/${shared.data.snippet.id}`,
      { name: 'Current creators' }
    )
    expect(updated).toHaveStatus(200)
    expect(updated).toHaveJsonPath('snippet.name', 'Current creators')

    const removed = await ownerBrowser.request.delete(
      `${apiPath}/${personal.data.snippet.id}`,
      {}
    )
    expect(removed).toHaveStatus(200)
    expect(removed).toHaveJsonPath('deleted', true)

    const audit = await sails.models.auditlog.findOne({
      action: 'helm.snippet.created',
      resourceId: String(shared.data.snippet.id)
    })
    expect(audit.details.name).toBe('Active creators')
    expect(JSON.stringify(audit).includes('await Creator.find')).toBe(false)
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
