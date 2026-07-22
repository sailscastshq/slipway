const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const { test } = require('sounding')

function deploymentWorld(slug) {
  return {
    name: 'configured-slipway',
    context: {
      cliActor: true,
      deploymentTarget: { slug }
    }
  }
}

function deployPath(slug) {
  return `/api/v1/projects/${slug}/environments/production/apps/web/deploy`
}

test(
  'web deploy rejects missing source before creating deployment history',
  { transport: 'http', world: deploymentWorld('missing-source') },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'slipway-deploy-api-')
    )
    const originalAppsDir = sails.config.custom.slipwayAppsDir
    sails.config.custom.slipwayAppsDir = tempRoot

    try {
      const response = await request
        .as('genesisUser')
        .post(deployPath(current.projects.deploymentTarget.slug), {})

      expect(response).toHaveStatus(400)
      expect(response).toHaveJsonPath('code', 'deploymentSourceUnavailable')
      expect(response).toHaveJsonPath(
        'guidance',
        'Run `slipway slide` from your project or connect a repository, then try again.'
      )
      const deployments = await sails.models.deployment.find({
        environment: current.environments.production.id
      })
      expect(deployments).toEqual([])
    } finally {
      sails.config.custom.slipwayAppsDir = originalAppsDir
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  }
)

test(
  'web deploy reuses source uploaded through the CLI endpoint',
  { transport: 'http', world: deploymentWorld('pushed-source') },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'slipway-deploy-api-')
    )
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
      const source = new FormData()
      source.append(
        'source',
        new Blob([fs.readFileSync(tarballPath)], {
          type: 'application/gzip'
        }),
        'source.tar.gz'
      )

      const upload = await request
        .as('genesisUser')
        .post(
          `/api/v1/projects/${current.projects.deploymentTarget.slug}/push`,
          source
        )

      expect(upload).toHaveStatus(200)
      expect(upload).toHaveJsonPath(
        'project',
        current.projects.deploymentTarget.slug
      )
      expect(
        fs.existsSync(
          path.join(
            tempRoot,
            current.projects.deploymentTarget.slug,
            'Dockerfile'
          )
        )
      ).toBe(true)

      await world.create('deployment').with({
        status: 'stopped',
        environment: current.environments.production.id,
        app: current.apps.web.id,
        gitCommit: 'stale-commit',
        gitBranch: 'stale-branch',
        gitMessage: 'Stale repository deployment',
        startedAt: Date.now() - 1000,
        finishedAt: Date.now() - 500
      })

      const response = await request
        .as('genesisUser')
        .post(deployPath(current.projects.deploymentTarget.slug), {})
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
  }
)
