const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const { test } = require('sounding')

const { createCsrfSession } = require('../../world-helpers/csrf-request')
const pushSource = require('../../../api/controllers/api/v1/project/push-source')

async function createDeployTarget(sails, current, slug) {
  const project = await sails.models.project
    .create({
      name: slug,
      slug,
      team: current.teams.genesisTeam.id,
      createdBy: current.users.genesisUser.id
    })
    .fetch()
  const environment = await sails.models.environment
    .create({
      name: 'Production',
      slug: 'production',
      project: project.id,
      isProduction: true
    })
    .fetch()
  const app = await sails.models.app
    .create({
      name: 'Web',
      slug: 'web',
      environment: environment.id,
      isDefault: true
    })
    .fetch()

  return { project, environment, app }
}

function apiClient(sails, current) {
  const csrf = createCsrfSession({
    userId: current.users.genesisUser.id,
    teamId: current.teams.genesisTeam.id
  })
  return sails.sounding.request.withSession(csrf.session).withHeaders({
    'x-csrf-token': csrf.token,
    accept: 'application/json'
  })
}

test('web deploy rejects missing source before creating deployment history', async ({
  sails,
  expect
}) => {
  const current = await sails.sounding.world.use('configured-slipway')
  const { environment } = await createDeployTarget(
    sails,
    current,
    'missing-source'
  )
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-deploy-api-'))
  const originalAppsDir = sails.config.custom.slipwayAppsDir
  sails.config.custom.slipwayAppsDir = tempRoot

  try {
    const response = await apiClient(sails, current).post(
      '/api/v1/projects/missing-source/environments/production/apps/web/deploy',
      {}
    )

    expect(response).toHaveStatus(400)
    expect(response).toHaveJsonPath('code', 'deploymentSourceUnavailable')
    expect(response).toHaveJsonPath(
      'guidance',
      'Run `slipway slide` from your project or connect a repository, then try again.'
    )
    const deployments = await sails.models.deployment.find({
      environment: environment.id
    })
    expect(deployments).toEqual([])
  } finally {
    sails.config.custom.slipwayAppsDir = originalAppsDir
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('web deploy reuses persisted CLI-pushed source', async ({
  sails,
  expect
}) => {
  const current = await sails.sounding.world.use('configured-slipway')
  const { environment, app } = await createDeployTarget(
    sails,
    current,
    'pushed-source'
  )
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-deploy-api-'))
  const uploadRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'slipway-source-upload-')
  )
  const sourceRoot = path.join(uploadRoot, 'source')
  const tarballPath = path.join(uploadRoot, 'source.tar.gz')
  fs.mkdirSync(sourceRoot)
  fs.writeFileSync(path.join(sourceRoot, 'Dockerfile'), 'FROM node:22\n')
  execFileSync('tar', ['czf', tarballPath, '-C', sourceRoot, '.'])

  const originalAppsDir = sails.config.custom.slipwayAppsDir
  const originalExecutePipeline = sails.helpers.deploy.executePipeline
  const originalEnsureBuildContext = sails.helpers.deploy.ensureBuildContext
  const pipelineCalls = []
  sails.config.custom.slipwayAppsDir = tempRoot
  sails.helpers.deploy.ensureBuildContext = {
    with: async () => {
      throw new Error('source preparation should run inside the pipeline')
    }
  }
  sails.helpers.deploy.executePipeline = {
    with: async (options) => pipelineCalls.push(options)
  }

  try {
    await pushSource.fn.call(
      {
        req: {
          session: { userId: current.users.genesisUser.id },
          file: () => ({
            upload: (_options, done) => done(null, [{ fd: tarballPath }])
          })
        }
      },
      { projectSlug: 'pushed-source' }
    )
    expect(
      fs.existsSync(path.join(tempRoot, 'pushed-source', 'Dockerfile'))
    ).toBe(true)

    await sails.models.deployment.create({
      status: 'stopped',
      environment: environment.id,
      app: app.id,
      gitCommit: 'stale-commit',
      gitBranch: 'stale-branch',
      gitMessage: 'Stale repository deployment',
      startedAt: Date.now() - 1000,
      finishedAt: Date.now() - 500
    })

    const response = await apiClient(sails, current).post(
      '/api/v1/projects/pushed-source/environments/production/apps/web/deploy',
      {}
    )
    await new Promise((resolve) => setImmediate(resolve))

    expect(response).toHaveStatus(202)
    expect(Boolean(response.data?.deployment?.id)).toBe(true)
    expect(pipelineCalls.length).toBe(1)
    const deployment = await sails.models.deployment.findOne({
      id: response.data.deployment.id
    })
    expect(deployment.status).toBe('pending')
    expect(deployment.gitCommit).toBe(null)
    expect(deployment.gitBranch).toBe(null)
    expect(deployment.gitMessage).toBe(null)
  } finally {
    sails.helpers.deploy.executePipeline = originalExecutePipeline
    sails.helpers.deploy.ensureBuildContext = originalEnsureBuildContext
    sails.config.custom.slipwayAppsDir = originalAppsDir
    fs.rmSync(tempRoot, { recursive: true, force: true })
    fs.rmSync(uploadRoot, { recursive: true, force: true })
  }
})
