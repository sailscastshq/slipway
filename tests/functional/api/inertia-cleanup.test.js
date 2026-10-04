const { test } = require('sounding')
const assert = require('node:assert/strict')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'remaining saved-record endpoints preserve paired Inertia and REST status, validation and persistence',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'inertia-cleanup' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    await sails.helpers.wake.ensureSchema()
    const { apps, environments, projects, users, teams } = world.current
    const base = '/projects/inertia-cleanup/environments/production'
    const appPath = base + '/apps/web'
    const browser = await withCsrfFromPage(request, appPath, 'genesisUser')
    const page = browser.request.withHeaders({ referer: appPath })
    const rest = browser.request.withHeaders({
      'X-Inertia': '',
      accept: 'application/json'
    })
    async function mutation(
      client,
      method,
      url,
      data,
      status = 200,
      location = appPath
    ) {
      const result = await client[method](url, data)
      expect(result).toHaveStatus(client === rest ? status : 303)
      if (client !== rest) expect(result).toHaveHeader('location', location)
      return result
    }
    const originalRoute = sails.helpers.caddy.updateRoute
    const originalFinish = sails.helpers.caddy.finishRouteUpdate
    sails.helpers.caddy.updateRoute = {
      with: async () => ({ transaction: { fixture: true } })
    }
    sails.helpers.caddy.finishRouteUpdate = { with: async () => {} }
    try {
      for (const client of [rest, page]) {
        const suffix = client === rest ? 'rest' : 'page'
        await mutation(client, 'patch', '/api/v1' + base, {
          domain: `${suffix}.example.test`
        })
        assert.equal(
          (
            await sails.models.environment.findOne({
              id: environments.production.id
            })
          ).domain,
          `${suffix}.example.test`
        )
        await mutation(client, 'patch', '/api/v1/bosun/env', {
          envVars: { CONTRACT: suffix }
        })
        assert.equal(
          JSON.parse(await sails.helpers.setting.get('instanceEnvVars'))
            .CONTRACT,
          suffix
        )
        const flagsUrl = '/api/v1' + appPath + '/flags'
        const flagResponse = await mutation(
          client,
          'post',
          flagsUrl,
          { key: suffix },
          201
        )
        const flag = await sails.models.featureflag.findOne({
          app: apps.web.id,
          key: suffix
        })
        if (client === rest) assert.equal(flagResponse.data.flag.id, flag.id)
        await mutation(client, 'patch', `${flagsUrl}/${flag.id}`, {
          enabled: true,
          rolloutPercentage: 100,
          targets: [],
          description: suffix
        })
        assert.equal(
          (await sails.models.featureflag.findOne({ id: flag.id })).enabled,
          true
        )
        const invalid = await client.post(flagsUrl, { key: suffix })
        expect(invalid).toHaveStatus(client === rest ? 400 : 303)
        await mutation(client, 'delete', `${flagsUrl}/${flag.id}`)
        assert.equal(
          await sails.models.featureflag.findOne({ id: flag.id }),
          undefined
        )

        const helmUrl = '/api/v1' + base + '/helm'
        await mutation(
          client,
          'post',
          helmUrl + '/snippets',
          { name: suffix, source: '1 + 1', scope: 'personal' },
          201
        )
        const snippet = await sails.models.helmsnippet.findOne({
          name: suffix,
          project: projects.deploymentTarget.id
        })
        await mutation(client, 'patch', `${helmUrl}/snippets/${snippet.id}`, {
          name: `${suffix}-updated`,
          source: '2 + 2'
        })
        assert.equal(
          (await sails.models.helmsnippet.findOne({ id: snippet.id })).source,
          '2 + 2'
        )
        expect(
          await client.patch(`${helmUrl}/snippets/${snippet.id}`, { name: ' ' })
        ).toHaveStatus(client === rest ? 400 : 303)
        await mutation(client, 'delete', `${helmUrl}/snippets/${snippet.id}`)
        assert.equal(
          await sails.models.helmsnippet.findOne({ id: snippet.id }),
          undefined
        )
        const common = {
          user: users.genesisUser.id,
          team: teams.genesisTeam.id,
          project: projects.deploymentTarget.id,
          environment: environments.production.id,
          app: apps.web.id,
          target: 'web',
          executedAt: Date.now(),
          source: '1 + 1'
        }
        const history = await sails.models.helmhistoryentry
          .create({ ...common })
          .fetch()
        await mutation(client, 'patch', `${helmUrl}/history/${history.id}`, {
          pinned: true
        })
        assert.equal(
          (await sails.models.helmhistoryentry.findOne({ id: history.id }))
            .pinned,
          true
        )
        await sails.models.helmhistoryentry.create({
          ...common,
          source: '2 + 2'
        })
        await mutation(client, 'delete', helmUrl + '/history', {
          includePinned: false
        })
        assert.equal(
          await sails.models.helmhistoryentry.count({
            environment: environments.production.id
          }),
          1
        )
        await mutation(client, 'delete', `${helmUrl}/history/${history.id}`)
        assert.equal(
          await sails.models.helmhistoryentry.count({
            environment: environments.production.id
          }),
          0
        )

        const externalUrl = '/api/v1' + base + '/services/external'
        const externalResponse = await mutation(
          client,
          'post',
          externalUrl,
          {
            name: `external-${suffix}`,
            configuration: {
              dsn: `postgresql://user:fixture-${suffix}@database.example.test/app`
            }
          },
          201
        )
        const service = await sails.models.service.findOne({
          name: `external-${suffix}`
        })
        if (client === rest)
          assert.equal(externalResponse.data.service.id, service.id)
        assert.equal(
          JSON.stringify(externalResponse.data || {}).includes(
            `fixture-${suffix}`
          ),
          false
        )
        await mutation(
          client,
          'patch',
          `/api/v1/services/${service.id}/external`,
          {
            configuration: {
              dsn: 'postgresql://user:rotated-fixture@database.example.test/app'
            }
          }
        )
        assert.equal(
          (await sails.models.service.findOne({ id: service.id }).decrypt())
            .externalConnection.password,
          'rotated-fixture'
        )
        expect(
          await client.patch(`/api/v1/services/${service.id}/external`, {
            configuration: { dsn: 'invalid' }
          })
        ).toHaveStatus(client === rest ? 400 : 303)
        const customService = await world.create('service').with({
          name: `custom-${suffix}`,
          type: 'custom',
          status: 'running',
          environment: environments.production.id,
          internalHost: `custom-${suffix}`,
          internalPort: 8080,
          customState: {
            appIds: [],
            linkPrefix: `CUSTOM_${suffix.toUpperCase()}`
          }
        })
        const linksUrl = `/api/v1/services/${customService.id}/custom-links`
        await mutation(client, 'patch', linksUrl, {
          appIds: [String(apps.web.id)]
        })
        assert.deepEqual(
          (await sails.models.service.findOne({ id: customService.id }))
            .customState.appIds,
          [String(apps.web.id)]
        )
        expect(
          await client.patch(linksUrl, { appIds: ['999999999'] })
        ).toHaveStatus(client === rest ? 400 : 303)
        await mutation(client, 'patch', linksUrl, { appIds: [] })
        const settings = {
          mode: 'first-party',
          requireConsent: true,
          respectPrivacySignals: true,
          allowedOrigins: [],
          excludedPaths: []
        }
        await mutation(client, 'post', appPath + '/wake/settings', {
          enabled: true,
          settings
        })
        assert.equal(
          (await sails.models.app.findOne({ id: apps.web.id })).wakeEnabled,
          true
        )
        expect(
          await client.post(appPath + '/wake/settings', {
            enabled: true,
            settings: { ...settings, mode: 'invalid' }
          })
        ).toHaveStatus(client === rest ? 400 : 303)
        await mutation(
          client,
          'delete',
          appPath + '/wake/visitors/visitor_fixture',
          {},
          200,
          appPath + '/wake?tab=journeys'
        )
      }
    } finally {
      sails.helpers.caddy.updateRoute = originalRoute
      sails.helpers.caddy.finishRouteUpdate = originalFinish
    }
    const guest = await request.post('/api/v1' + appPath + '/flags', {
      key: 'guest'
    })
    assert.ok([401, 403, 302, 303].includes(guest.status))
  }
)
