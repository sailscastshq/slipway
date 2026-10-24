const { test } = require('sounding')
const { createSessionCookie } = require('sounding/lib/create-session-cookie')
const { withCsrfFromPage } = require('../../support/csrf-request')
test(
  'CI workspace is read-only and rejects projects and environments outside the current team',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'ci-access' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const project = world.current.projects.deploymentTarget
    const cookie = await createSessionCookie(sails, {
      userId: world.current.users.genesisUser.id
    })
    const browser = await withCsrfFromPage(request.withHeaders({ cookie }), '/')
    const result = await browser.request.get(`/projects/${project.slug}/ci`)
    expect(result).toBeInertiaPage('projects/ci')
    expect(result.data.props.workspace).toEqual({
      version: 1,
      runner: 'not-configured',
      readOnly: true,
      runs: []
    })
    const team = await world.create('team').with({
      name: 'Another tenant',
      owner: world.current.users.genesisUser.id
    })
    const foreign = await world.create('project').with({
      slug: 'other-ci-tenant',
      name: 'Other CI',
      team: team.id,
      createdBy: world.current.users.genesisUser.id
    })
    await world
      .create('environment')
      .with({ project: foreign.id, slug: 'secret-environment' })
    expect(
      await browser.request.get(`/projects/${foreign.slug}/ci`)
    ).toHaveStatus(404)
    expect(
      await browser.request.get(
        `/projects/${project.slug}/environments/secret-environment/ci`
      )
    ).toHaveStatus(404)
  }
)
