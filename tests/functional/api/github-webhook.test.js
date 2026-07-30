const crypto = require('crypto')

const { test } = require('sounding')

const PR_ACTIONS = ['opened', 'reopened', 'synchronize', 'closed']

test(
  'GitHub pull request webhooks never create deployment resources',
  { world: 'configured-slipway' },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const secret = 'signed-pull-request-secret'
    const project = await world.create('project').with({
      name: 'Webhook Project',
      slug: 'webhook-project',
      autoDeploy: true,
      webhookSecret: secret,
      team: current.teams.genesisTeam.id,
      createdBy: current.users.genesisUser.id
    })
    const environment = await world
      .create('environment')
      .trait('production')
      .with({ project: project.id })
    const app = await world
      .create('app')
      .trait('configured')
      .with({ environment: environment.id })
    const provider = await world.create('gitprovider').with({
      team: current.teams.genesisTeam.id
    })
    const repository = await world.create('gitrepository').with({
      externalId: '298',
      webhookSecret: secret,
      provider: provider.id,
      environment: environment.id,
      app: app.id
    })
    const baseline = await resourceCounts(sails, project.id)

    for (const action of PR_ACTIONS) {
      const payload = pullRequestPayload({
        action,
        repositoryId: Number(repository.externalId)
      })
      const canonical = await signedRequest(request, {
        secret,
        event: 'pull_request',
        delivery: `pull-request-${action}`,
        payload
      }).post('/webhook/github', payload)
      const legacy = await signedRequest(request, {
        secret,
        event: 'pull_request',
        delivery: `legacy-pull-request-${action}`,
        payload
      }).post(`/api/v1/webhooks/github/${project.slug}`, payload)

      expect(canonical).toHaveStatus(200)
      expect(canonical).toHaveJsonPath('action', 'ignored')
      expect(canonical).toHaveJsonPath('reason', 'unsupported_event')
      expect(legacy).toHaveStatus(200)
      expect(legacy).toHaveJsonPath('action', 'ignored')
      expect(legacy).toHaveJsonPath('reason', 'unsupported_event')
      expect(await resourceCounts(sails, project.id)).toEqual(baseline)
    }

    const deletion = {
      ref: 'fix/webhook-target',
      ref_type: 'branch',
      repository: {
        id: Number(repository.externalId),
        full_name: 'sailscastshq/site'
      }
    }
    const canonicalDeletion = await signedRequest(request, {
      secret,
      event: 'delete',
      delivery: 'branch-delete',
      payload: deletion
    }).post('/webhook/github', deletion)
    const legacyDeletion = await signedRequest(request, {
      secret,
      event: 'delete',
      delivery: 'legacy-branch-delete',
      payload: deletion
    }).post(`/api/v1/webhooks/github/${project.slug}`, deletion)

    expect(canonicalDeletion).toHaveJsonPath('action', 'ignored')
    expect(legacyDeletion).toHaveJsonPath('action', 'ignored')
    expect(await resourceCounts(sails, project.id)).toEqual(baseline)
  }
)

function signedRequest(request, { secret, event, delivery, payload }) {
  return request.withHeaders({
    'x-github-event': event,
    'x-github-delivery': delivery,
    'x-hub-signature-256': signature(secret, payload)
  })
}

function pullRequestPayload({ action, repositoryId }) {
  return {
    ...pullRequestPayloadBody(),
    action,
    repository: {
      id: repositoryId,
      full_name: 'sailscastshq/site'
    }
  }
}

function pullRequestPayloadBody() {
  return {
    action: 'opened',
    pull_request: {
      number: 42,
      title: 'Keep deployments in the configured environment',
      head: {
        ref: 'fix/webhook-target',
        sha: '2982982982982982982982982982982982982982'
      }
    },
    repository: {
      id: 298,
      full_name: 'sailscastshq/site'
    }
  }
}

function signature(secret, payload) {
  return `sha256=${crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex')}`
}

async function resourceCounts(sails, projectId) {
  const environments = await sails.models.environment.find({
    project: projectId
  })
  const environmentIds = environments.map((environment) => environment.id)

  return {
    environments: environments.length,
    apps: await sails.models.app.count({
      environment: { in: environmentIds }
    }),
    services: await sails.models.service.count({
      environment: { in: environmentIds }
    }),
    deployments: await sails.models.deployment.count({
      environment: { in: environmentIds }
    })
  }
}
