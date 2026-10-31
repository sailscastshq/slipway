const assert = require('node:assert/strict')
const { test } = require('sounding')

test(
  'Breadcrumb contexts stay within the live team and hierarchy and transfer only app indexes',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'navigation-qa' } }
    }
  },
  async ({ world, sails, request, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const env = current.environments.production
    const app = current.apps.web
    const other = await world
      .create('app')
      .with({ name: 'Companion', slug: 'companion', environment: env.id })
    const foreignTeam = await world
      .create('team')
      .with({ owner: current.users.genesisUser.id })
    const foreign = await world.create('project').with({
      name: 'Private project',
      slug: 'private-project',
      team: foreignTeam.id
    })
    const args = {
      kind: 'app',
      projectSlug: project.slug,
      environmentSlug: env.slug,
      appSlug: app.slug,
      section: 'bearing'
    }
    const get = (params, actor = 'genesisUser') =>
      request
        .as(actor)
        .get('/api/v1/navigation/contexts?' + new URLSearchParams(params))
    const result = await get(args)
    expect(result).toHaveStatus(200)
    assert.equal(result.data.items.length, 2)
    const target = result.data.items.find((item) => item.slug === other.slug)
    assert.equal(
      target.href,
      `/projects/${project.slug}/environments/${env.slug}/apps/companion/bearing`
    )
    assert.equal(
      result.data.items.find((item) => item.slug === app.slug).current,
      true
    )
    assert.deepEqual(Object.keys(target).sort(), [
      'current',
      'href',
      'name',
      'slug'
    ])
    const fallback = await get({ ...args, section: 'bridge/secret/record' })
    assert.equal(fallback.data.items[0].href.endsWith('/bearing'), false)
    const projects = await get({ ...args, kind: 'project' })
    assert.equal(
      projects.data.items.some((item) => item.slug === foreign.slug),
      false
    )
    assert.equal(projects.data.items[0].href, `/projects/${project.slug}`)
    const environments = await get({ ...args, kind: 'environment' })
    assert.equal(
      environments.data.items[0].href,
      `/projects/${project.slug}/environments/${env.slug}`
    )
    expect(await get({ ...args, projectSlug: foreign.slug })).toHaveStatus(404)
    expect(await get({ ...args, environmentSlug: 'deleted' })).toHaveStatus(404)
    expect(await get({ ...args, appSlug: 'deleted' })).toHaveStatus(404)
    const member = await world
      .create('user')
      .with({ team: current.teams.genesisTeam.id, teamRole: 'member' })
    expect(await get(args, member)).toHaveStatus(403)
    expect(
      await request.get(
        '/api/v1/navigation/contexts?' + new URLSearchParams(args)
      )
    ).toHaveStatus(401)
    await sails.models.app.destroyOne({ id: other.id })
    assert.equal(
      (await get(args)).data.items.some((item) => item.slug === other.slug),
      false
    )
  }
)
