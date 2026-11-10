const { test } = require('sounding')
const assert = require('node:assert/strict')
const { createSessionCookie } = require('sounding/lib/create-session-cookie')
const { withCsrfFromPage } = require('../../support/csrf-request')
const config = require('../../../api/lib/beacon/public-page')

test(
  'public Beacon is opt-in, guest-readable, scoped, and contains no dashboard examples',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'public-beacon', name: 'Harbor' } }
    }
  },
  async ({ sails, world, request, visit, expect }) => {
    const { apps, environments, teams } = world.current
    const dashboard =
      '/projects/public-beacon/environments/production/apps/web/beacon'
    const renderer = '/_slipway/beacon/host/public-beacon/production/web'
    const ownerCookie = await createSessionCookie(sails, {
      userId: world.current.users.genesisUser.id
    })
    const owner = (
      await withCsrfFromPage(
        request.using('http').withHeaders({ cookie: ownerCookie }),
        dashboard
      )
    ).request
    expect(await request.get(renderer)).toHaveStatus(404)
    const member = await world
      .create('user')
      .with({ team: teams.genesisTeam.id, teamRole: 'member' })
    const memberCookie = await createSessionCookie(sails, { userId: member.id })
    const memberRequest = (
      await withCsrfFromPage(
        request.using('http').withHeaders({ cookie: memberCookie }),
        dashboard
      )
    ).request
    expect(
      await memberRequest.patch(dashboard + '/public', { enabled: true })
    ).toHaveStatus(403)
    expect(
      await request.patch(dashboard + '/public', { enabled: true })
    ).toHaveStatus(403)
    const conflict = await world.create('app').with({
      environment: environments.production.id,
      slug: 'conflicting',
      routePath: '/beacon'
    })
    expect(
      await owner.patch(dashboard + '/public', { enabled: true })
    ).toHaveStatus(400)
    await sails.models.app.destroyOne({ id: conflict.id })
    expect(
      await owner.patch(dashboard + '/public', { enabled: true })
    ).toHaveStatus(303)
    const page = await visit(renderer + '?preview=down')
    expect(page).toBeInertiaPage('beacon/public')
    expect(page).toHaveInertiaProp('availability.status', 'unknown')
    expect(page).toHaveInertiaProp('availability.lastCheckedAt', null)
    expect(page).toHaveInertiaProp(
      'hostAssetBasePath',
      '/_slipway/beacon/_assets'
    )
    expect(page).toHaveInertiaProp('app.name', 'Harbor')
    expect(page.data.url).toBe('/beacon?preview=down')
    for (const forbidden of [
      'preview',
      'deployment',
      'checker',
      'project',
      'environment'
    ]) {
      assert.equal(Object.hasOwn(page.data.props, forbidden), false)
    }
    expect(await request.get(renderer + '/_/appearance.css')).toHaveStatus(200)
    expect(
      await request.get(renderer.replace('/production/', '/other/'))
    ).toHaveStatus(404)
    expect(await request.get(renderer.replace('/web', '/other'))).toHaveStatus(
      404
    )
    await sails.models.app
      .updateOne({ id: apps.web.id })
      .set({ routePath: '/academy' })
    const mounted = await visit(renderer)
    expect(mounted.data.url).toBe('/academy/beacon')
    expect(mounted).toHaveInertiaProp(
      'hostAssetBasePath',
      '/academy/_slipway/beacon/_assets'
    )
    expect(mounted).toHaveInertiaProp('app.homePath', '/academy')
    expect(
      await owner.patch(dashboard + '/public', { enabled: false })
    ).toHaveStatus(303)
    expect(await request.get(renderer)).toHaveStatus(404)
    expect(await request.get(renderer + '/_/appearance.css')).toHaveStatus(404)
    await sails.models.app
      .updateOne({ id: apps.web.id })
      .set({ routePath: null })
    expect(
      await owner.patch(dashboard + '/public', { enabled: true })
    ).toHaveStatus(400)
    await sails.helpers.setting.set(
      config.key(apps.web.id),
      JSON.stringify({ enabled: true })
    )
    expect(await request.get(renderer)).toHaveStatus(404)
    await sails.models.app.destroyOne({ id: apps.web.id })
    expect(
      await sails.models.setting.count({ key: config.key(apps.web.id) })
    ).toBe(0)
  }
)
