const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

function appWorld(label) {
  return {
    name: 'configured-slipway',
    context: { deploymentTarget: { slug: `optional-repository-${label}` } }
  }
}

async function setup(request, current) {
  const base = `/projects/${current.projects.deploymentTarget.slug}/environments/production`
  const browser = await withCsrfFromPage(request, base, 'genesisUser')
  return { ...browser, base, url: `${base}/apps` }
}

for (const [label, fields] of [
  ['null', { repoId: null, branch: null }],
  ['omitted', {}],
  ['empty', { repoId: '', branch: '' }]
]) {
  test(
    `Add App accepts ${label} optional repository fields without linking a repository`,
    { world: appWorld(label) },
    async ({ sails, world, request, expect }) => {
      const browser = await setup(request, world.current)
      const appsBefore = await sails.models.app.count()
      const repositoriesBefore = await sails.models.gitrepository.count()
      const payload = {
        name: 'Companion',
        dockerfilePath: 'Dockerfile',
        healthPath: '/health',
        routePath: '/',
        ...fields
      }
      const validation = await browser.request
        .withHeaders({
          Precognition: 'true',
          'Precognition-Validate-Only': 'name'
        })
        .post(browser.url, payload)

      expect(validation).toHaveStatus(204)
      expect(validation).toHaveHeader('precognition-success', 'true')
      expect(await sails.models.app.count()).toBe(appsBefore)
      expect(await sails.models.gitrepository.count()).toBe(repositoriesBefore)

      const created = await browser.request.post(browser.url, payload)
      expect(created).toHaveStatus(302)
      expect(created).toRedirectTo(browser.base)
      expect(await sails.models.app.count()).toBe(appsBefore + 1)
      expect(await sails.models.gitrepository.count()).toBe(repositoriesBefore)
      const app = await sails.models.app.findOne({
        environment: world.current.environments.production.id,
        slug: 'companion'
      })
      expect(app.name).toBe('Companion')
      expect(app.isDefault).toBe(false)
    }
  )
}

test(
  'Add App still rejects invalid configuration with null repository fields',
  { world: appWorld('invalid') },
  async ({ sails, world, request, expect }) => {
    const browser = await setup(request, world.current)
    const appsBefore = await sails.models.app.count()
    for (const [field, value] of [
      ['name', '---'],
      ['healthPath', 'https://example.com/health'],
      ['name', world.current.apps.web.name]
    ]) {
      const response = await browser.request
        .withHeaders({
          Precognition: 'true',
          'Precognition-Validate-Only': field
        })
        .post(browser.url, {
          name: 'Companion',
          dockerfilePath: 'Dockerfile',
          routePath: '/',
          healthPath: '/health',
          repoId: null,
          branch: null,
          [field]: value
        })
      expect(response).toHaveStatus(422)
      expect(Boolean(response.data.errors[field])).toBe(true)
      expect(response.data.errors.repoId).toBe(undefined)
      expect(response.data.errors.branch).toBe(undefined)
    }
    expect(await sails.models.app.count()).toBe(appsBefore)
  }
)

test(
  'Add App links a selected repository using its default or explicit branch',
  { world: appWorld('linked') },
  async ({ sails, world, request, expect }) => {
    const browser = await setup(request, world.current)
    await world.create('gitprovider').with({
      team: world.current.teams.genesisTeam.id
    })
    const git = sails.helpers.git
    const original = {
      getGithubRepo: git.getGithubRepo,
      generateDeployKey: git.generateDeployKey,
      addGithubDeployKey: git.addGithubDeployKey,
      createGithubWebhook: git.createGithubWebhook
    }
    const calls = []
    git.getGithubRepo = async (token, repoId) => {
      calls.push(repoId)
      return {
        name: 'companion',
        owner: 'fixture',
        fullName: 'fixture/companion',
        cloneUrl: 'git@github.com:fixture/companion.git',
        htmlUrl: 'https://github.com/fixture/companion',
        defaultBranch: 'main',
        isPrivate: true
      }
    }
    git.generateDeployKey = async () => ({
      publicKey: 'fixture-public-key',
      privateKey: 'fixture-private-key'
    })
    git.addGithubDeployKey = async () => ({ id: 301 })
    git.createGithubWebhook = async () => ({ id: 401 })
    try {
      for (const branch of [null, 'release']) {
        const payload = {
          name: branch ? 'Release' : 'Default',
          repoId: '201',
          branch
        }
        const appsBefore = await sails.models.app.count()
        const validation = await browser.request
          .withHeaders({ Precognition: 'true' })
          .post(browser.url, payload)
        expect(validation).toHaveStatus(204)
        expect(await sails.models.app.count()).toBe(appsBefore)
        expect(calls.length).toBe(branch ? 1 : 0)

        const created = await browser.request.post(browser.url, payload)
        expect(created).toHaveStatus(302)
        const app = await sails.models.app.findOne({
          environment: world.current.environments.production.id,
          slug: branch ? 'release' : 'default'
        })
        const repository = await sails.models.gitrepository.findOne({
          app: app.id
        })
        expect(repository.externalId).toBe('201')
        expect(repository.branchMappings).toEqual({
          [branch || 'main']: 'production'
        })
      }
      expect(calls).toEqual(['201', '201'])
    } finally {
      Object.assign(git, original)
    }
  }
)
