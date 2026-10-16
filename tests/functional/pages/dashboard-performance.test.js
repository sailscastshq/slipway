const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'dashboard batches team app statuses and retains default, fallback and empty states',
  { world: 'configured-slipway' },
  async ({ sails, world, request, expect }) => {
    const team = world.current.teams.genesisTeam
    const user = world.current.users.genesisUser
    const makeProject = async (slug, teamId = team.id) =>
      world.create('project').with({
        name: slug,
        slug,
        team: teamId,
        createdBy: user.id
      })
    const makeEnv = async (project, slug = 'production') =>
      world.create('environment').with({ project: project.id, slug })
    const makeApp = async (environment, slug, status, isDefault = false) =>
      world
        .create('app')
        .with({ environment: environment.id, slug, status, isDefault })

    const empty = await makeProject('empty')
    const noApps = await makeProject('no-apps')
    await makeEnv(noApps)
    const defaults = await makeProject('default-preferred')
    const defaultEnv = await makeEnv(defaults)
    await makeApp(defaultEnv, 'first', 'failed')
    await makeApp(defaultEnv, 'default', 'running', true)
    await makeApp(defaultEnv, 'second-default', 'failed')
    const fallback = await makeProject('fallback')
    const fallbackEnv = await makeEnv(fallback)
    await makeApp(fallbackEnv, 'first', 'building')
    await makeApp(fallbackEnv, 'second', 'running')
    await sails.models.app
      .update({ environment: fallbackEnv.id })
      .set({ isDefault: false })
    const mixed = await makeProject('mixed')
    for (let i = 0; i < 12; i++) {
      const env = await makeEnv(mixed, `environment-${i}`)
      await makeApp(env, 'web', i === 11 ? 'deploying' : 'running', true)
    }
    const otherTeam = await world
      .create('team')
      .with({ name: 'Other team', owner: user.id })
    const foreign = await makeProject('foreign-project', otherTeam.id)
    const foreignEnv = await makeEnv(foreign)
    await makeApp(foreignEnv, 'private-app', 'running', true)

    const browser = await withCsrfFromPage(request, '/', 'genesisUser')
    const originalFind = sails.models.app.find
    const originalFindOne = sails.models.app.findOne
    const queries = []
    let individualQueries = 0
    sails.models.app.find = function (criteria, ...args) {
      queries.push(criteria)
      return originalFind.call(this, criteria, ...args)
    }
    sails.models.app.findOne = function (...args) {
      individualQueries++
      return originalFindOne.apply(this, args)
    }
    try {
      const response = await browser.request.get('/')
      expect(response).toBeInertiaPage('dashboard/index')
      expect(queries.length).toBe(1)
      expect(individualQueries).toBe(0)
      expect(queries[0].environment.includes(foreignEnv.id)).toBe(false)
      const projects = response.data.props.projects
      expect(projects.some((project) => project.id === foreign.id)).toBe(false)
      for (const [project, status, runningCount] of [
        [empty, 'no_deployments', 0],
        [noApps, 'no_deployments', 0],
        [defaults, 'running', 1],
        [fallback, 'building', 0],
        [mixed, 'deploying', 11]
      ]) {
        const found = projects.find((item) => item.id === project.id)
        expect(found.status).toBe(status)
        expect(found.runningCount).toBe(runningCount)
      }
      await sails.models.app
        .updateOne({ environment: fallbackEnv.id, slug: 'first' })
        .set({ status: 'failed' })
      const refreshed = await browser.request.get('/')
      expect(
        refreshed.data.props.projects.find((item) => item.id === fallback.id)
          .status
      ).toBe('failed')
    } finally {
      sails.models.app.find = originalFind
      sails.models.app.findOne = originalFindOne
    }
  }
)

test(
  'dashboard with no environments skips app reads',
  { world: 'configured-slipway' },
  async ({ sails, request, expect }) => {
    const browser = await withCsrfFromPage(request, '/', 'genesisUser')
    const originalFind = sails.models.app.find
    let reads = 0
    sails.models.app.find = function (...args) {
      reads++
      return originalFind.apply(this, args)
    }
    try {
      const response = await browser.request.get('/')
      expect(response).toHaveInertiaProp('projects', [])
      expect(reads).toBe(0)
    } finally {
      sails.models.app.find = originalFind
    }
  }
)
