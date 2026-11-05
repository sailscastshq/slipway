const { test } = require('sounding')

test(
  'Beacon scopes its real empty state and explicit examples to the authenticated app',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'beacon-access', name: 'Beacon access' }
      }
    }
  },
  async ({ world, request, visit, expect }) => {
    const current = world.current
    const root =
      '/projects/beacon-access/environments/production/apps/web/beacon'
    const guest = await request.get(root)
    expect(guest).toHaveStatus(401)
    const empty = await visit.as('genesisUser')(root)
    expect(empty).toBeInertiaPage('projects/beacon')
    expect(empty).toHaveInertiaProp('checker.connected', false)
    expect(empty).toHaveInertiaProp('preview', null)
    const populated = await visit.as('genesisUser')(root + '?preview=healthy')
    expect(populated).toHaveInertiaProp('preview.status', 'up')
    expect(populated).toHaveInertiaProp(
      'preview.target',
      'https://example.com/health'
    )
    expect(populated).toHaveInertiaProp('checker.connected', false)
    expect(
      await visit.as('genesisUser')(root + '?preview=down')
    ).toHaveInertiaProp('preview.status', 'down')
    expect(
      await visit.as('genesisUser')(root + '?preview=stale')
    ).toHaveInertiaProp('preview.status', 'unknown')
    expect(
      await request.as('genesisUser').get(root + '?preview=invalid')
    ).toHaveStatus(400)
    expect(
      await request.as('genesisUser').get(root.replace('/web/', '/missing/'))
    ).toHaveStatus(403)
    expect(
      await request
        .as('genesisUser')
        .get(root.replace('/production/', '/other/'))
    ).toHaveStatus(403)
    const foreignTeam = await world
      .create('team')
      .with({ owner: current.users.genesisUser.id })
    await world.create('project').with({
      name: 'Other team',
      slug: 'foreign-beacon',
      team: foreignTeam.id,
      createdBy: current.users.genesisUser.id
    })
    expect(
      await request
        .as('genesisUser')
        .get(root.replace('beacon-access', 'foreign-beacon'))
    ).toHaveStatus(403)
    const contexts = await request.as('genesisUser').get(
      '/api/v1/navigation/contexts?' +
        new URLSearchParams({
          kind: 'app',
          projectSlug: 'beacon-access',
          environmentSlug: 'production',
          appSlug: 'web',
          section: 'beacon'
        })
    )
    expect(contexts).toHaveStatus(200)
    expect(contexts.data.items[0].href).toBe(root)
  }
)
