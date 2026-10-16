const { test } = require('sounding')
const assert = require('node:assert/strict')
const { createSessionCookie } = require('sounding/lib/create-session-cookie')
const { withCsrfFromPage } = require('../../support/csrf-request')
const decoys = require('../../../api/helpers/lookout/decoy-config')._private

test(
  'decoy settings enforce consent, authorization, collisions and route rollback without changing request totals',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'decoy-contract' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const app = world.current.apps.web
    const env = world.current.environments.production
    const project = world.current.projects.deploymentTarget
    const owner = world.current.users.genesisUser
    const cookie = await createSessionCookie(sails, { userId: owner.id })
    const session = await withCsrfFromPage(
      request.using('http').withHeaders({ cookie }),
      '/'
    )
    const client = session.request.withHeaders({
      'x-inertia': '',
      accept: 'application/json'
    })
    const url = `/api/v1/projects/${project.slug}/environments/${env.slug}/apps/${app.slug}/decoys`
    const good = { enabled: true, paths: ['/.env'], acknowledged: true }
    assert.equal(
      (await sails.helpers.lookout.decoyConfig([app]))[0].lookoutDecoys.enabled,
      false
    )
    for (const data of [
      { ...good, acknowledged: false },
      { ...good, paths: ['/.env*'] },
      { ...good, enabled: 'true' },
      { ...good, paths: ['/.env', '/.env'] }
    ])
      expect(await client.patch(url, data)).toHaveStatus(400)
    const validated = await client
      .withHeaders({ Precognition: 'true' })
      .patch(url, good)
    expect(validated).toHaveStatus(204)
    assert.equal(
      await sails.models.setting.findOne({ key: decoys.key(app.id) }),
      undefined
    )
    const outsider = await world.create('user')
    const otherTeam = await world.create('team').with({ owner: outsider.id })
    await sails.models.teammembership.findOrCreate(
      { key: `${outsider.id}:${otherTeam.id}` },
      {
        key: `${outsider.id}:${otherTeam.id}`,
        user: outsider.id,
        team: otherTeam.id,
        role: 'owner'
      }
    )
    await sails.models.user
      .updateOne({ id: outsider.id })
      .set({ team: otherTeam.id })
    const outsiderCookie = await createSessionCookie(sails, {
      userId: outsider.id
    })
    const outsiderSession = await withCsrfFromPage(
      request.using('http').withHeaders({ cookie: outsiderCookie }),
      '/'
    )
    expect(
      await outsiderSession.request
        .withHeaders({ 'x-inertia': '' })
        .patch(url, good)
    ).toHaveStatus(404)
    expect(await client.patch(url, good)).toHaveStatus(200)
    assert.equal(
      (await sails.helpers.lookout.decoyConfig([app]))[0].lookoutDecoys.enabled,
      true
    )
    expect(
      await client.patch(url.replace(project.slug, 'missing-project'), good)
    ).toHaveStatus(404)
    const member = await world
      .create('user')
      .with({ team: owner.team, teamRole: 'member' })
    const memberCookie = await createSessionCookie(sails, { userId: member.id })
    const memberSession = await withCsrfFromPage(
      request.using('http').withHeaders({ cookie: memberCookie }),
      '/'
    )
    expect(
      await memberSession.request
        .withHeaders({ 'x-inertia': '', accept: 'application/json' })
        .patch(url, good)
    ).toHaveStatus(403)
    await sails.models.user
      .updateOne({ id: owner.id })
      .set({ teamRole: 'owner' })
    expect(
      await client.patch(url.replace('/decoys', ''), { routePath: '/api' })
    ).toHaveStatus(400)
    expect(
      await client.patch(url.replace('/decoys', ''), { healthPath: '/.env' })
    ).toHaveStatus(400)
    const sibling = await world.create('app').with({
      environment: env.id,
      name: 'Shadow',
      slug: 'shadow',
      routePath: '/.env'
    })
    expect(await client.patch(url, good)).toHaveStatus(400)
    await sails.models.app.destroyOne({ id: sibling.id })
    await sails.models.app
      .updateOne({ id: app.id })
      .set({ healthPath: '/.env' })
    expect(await client.patch(url, good)).toHaveStatus(400)
    await sails.models.app
      .updateOne({ id: app.id })
      .set({ healthPath: '/health', hostPort: 31001 })
    const before = await sails.models.setting.findOne({
      key: decoys.key(app.id)
    })
    const original = {
      update: sails.helpers.caddy.updateRoute,
      finish: sails.helpers.caddy.finishRouteUpdate,
      set: sails.helpers.setting.set
    }
    const calls = []
    try {
      sails.helpers.caddy.updateRoute = {
        with: async () => {
          calls.push('stage')
          return { domains: ['fixture.test'], transaction: { test: true } }
        }
      }
      sails.helpers.setting.set = async () => {
        throw new Error('fixture storage failure')
      }
      sails.helpers.caddy.finishRouteUpdate = {
        with: async ({ action }) => {
          calls.push(action)
        }
      }
      expect(
        await client.patch(url, { enabled: false, paths: [] })
      ).toHaveStatus(400)
      assert.deepEqual(calls, ['stage', 'rollback'])
      calls.length = 0
      sails.helpers.setting.set = original.set
      sails.helpers.caddy.finishRouteUpdate = {
        with: async ({ action }) => {
          calls.push(action)
          if (action === 'commit') throw new Error('fixture rejection')
        }
      }
      expect(
        await client.patch(url, { enabled: false, paths: [] })
      ).toHaveStatus(400)
      assert.deepEqual(calls, ['stage', 'commit', 'rollback'])
      assert.equal(
        (await sails.models.setting.findOne({ key: before.key })).value,
        before.value
      )
      sails.helpers.caddy.finishRouteUpdate = {
        with: async () => {
          throw new Error('fixture recovery failure')
        }
      }
      const uncertain = await client.patch(url, { enabled: false, paths: [] })
      expect(uncertain).toHaveStatus(400)
      assert.ok(
        JSON.stringify(uncertain.data).includes('recovery is incomplete')
      )
      assert.ok(
        !JSON.stringify(uncertain.data).includes(
          'Previous settings were retained'
        )
      )
      sails.helpers.caddy.updateRoute = {
        with: async () => {
          throw new Error('fixture verification failed')
        }
      }
      expect(
        await client.patch(url, { enabled: false, paths: [] })
      ).toHaveStatus(400)
      assert.equal(
        (await sails.models.setting.findOne({ key: before.key })).value,
        before.value
      )
      sails.helpers.caddy.updateRoute = {
        with: async () => ({
          domains: ['fixture.test'],
          transaction: { test: true }
        })
      }
      sails.helpers.caddy.finishRouteUpdate = { with: async () => {} }
      expect(
        await client.patch(url, { enabled: false, paths: [] })
      ).toHaveStatus(200)
    } finally {
      sails.helpers.caddy.updateRoute = original.update
      sails.helpers.caddy.finishRouteUpdate = original.finish
      sails.helpers.setting.set = original.set
    }
    const crypto = require('node:crypto')
    const token = 'stk_' + crypto.randomBytes(24).toString('hex')
    await sails.models.environment.updateOne({ id: env.id }).set({
      telemetryTokenHash: crypto
        .createHash('sha256')
        .update(token)
        .digest('hex')
    })
    const ingest = await request
      .using('http')
      .withHeaders({ authorization: `Bearer ${token}` })
      .post('/api/v1/telemetry/ingest', {
        metrics: [
          { name: 'lookout.decoy_hit', value: 1 },
          { name: 'ordinary.fixture', value: 1 }
        ]
      })
    expect(ingest).toHaveStatus(200)
    assert.equal(
      await sails.models.telemetrymetric.count({ name: 'lookout.decoy_hit' }),
      0
    )
    assert.equal(
      await sails.models.telemetrymetric.count({ name: 'ordinary.fixture' }),
      1
    )
    await sails.models.telemetrymetric.create({
      environment: String(env.id),
      name: 'lookout.decoy_hit',
      unit: 'count',
      value: 1,
      recordedAt: Date.now(),
      attributes: {
        kind: 'decoy_hit',
        appId: String(app.id),
        path: '/.env',
        method: 'GET',
        statusCode: 200
      }
    })
    const page = await session.request.get(
      `/projects/${project.slug}/environments/${env.slug}/lookout?tab=decoys`
    )
    expect(page).toBeInertiaPage('projects/lookout')
    assert.equal(page.data.props.telemetry.requests.total, 0)
    assert.equal(page.data.props.decoys.groups[0].observed, 1)
    assert.equal(page.data.props.decoys.groups[0].statusCode, 200)
  }
)
