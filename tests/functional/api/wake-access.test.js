const { test } = require('sounding'),
  assert = require('node:assert/strict')
const { withCsrfFromPage } = require('../../support/csrf-request')
test(
  'Wake permits team reads, reserves settings/deletion for managers and rejects a different team and environment',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'wake-access' } }
    }
  },
  async ({ sails, world, request, visit }) => {
    const current = world.current,
      app = current.apps.web,
      base = `/projects/wake-access/environments/production/apps/${app.slug}/wake`
    const member = await world.create('user').with({
      email: 'wake-member@example.test',
      team: current.teams.genesisTeam.id,
      teamRole: 'member'
    })
    assert.equal((await visit.as(member)(base)).status, 200)
    const memberApi = (await withCsrfFromPage(request, '/', member)).request
    const settings = {
      mode: 'first-party',
      requireConsent: true,
      respectPrivacySignals: true,
      allowedOrigins: [],
      excludedPaths: []
    }
    assert.equal(
      (await memberApi.post(base + '/settings', { enabled: true, settings }))
        .status,
      403
    )
    assert.equal(
      (await memberApi.delete(base + '/visitors/visitor_12345')).status,
      403
    )
    const outsider = await world
      .create('user')
      .with({ email: 'wake-outsider@example.test' })
    const team = await world
      .create('team')
      .with({ name: 'Outside Wake', owner: outsider.id })
    await sails.models.user
      .updateOne({ id: outsider.id })
      .set({ team: team.id })
    assert.equal((await visit.as(outsider)(base)).status, 403)
    assert.equal(
      (
        await visit.as('genesisUser')(
          base.replace('/production/', '/different/')
        )
      ).status,
      403
    )
  }
)
