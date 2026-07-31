const crypto = require('node:crypto')
const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'release flags are app-scoped, audited, and available to the deployed app without redeploying',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'release-flags',
          name: 'Release flags'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const { projects, environments, apps } = world.current
    const project = projects.deploymentTarget
    const environment = environments.production
    const app = apps.web
    const token = 'stk_' + crypto.randomBytes(24).toString('hex')
    await sails.models.environment.updateOne({ id: environment.id }).set({
      telemetryToken: token,
      telemetryTokenHash: crypto
        .createHash('sha256')
        .update(token)
        .digest('hex')
    })
    const pagePath = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}`
    const dashboard = await withCsrfFromPage(request, pagePath, 'genesisUser')
    const flagsPath = `/api/v1/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/flags`

    const created = await dashboard.request.post(flagsPath, {
      key: 'new-checkout'
    })
    expect(created).toHaveStatus(201)
    expect(created.data.flag.enabled).toBe(false)
    expect(created.data.flag.rolloutPercentage).toBe(0)
    const duplicate = await dashboard.request.post(flagsPath, {
      key: 'new-checkout'
    })
    expect(duplicate).toHaveStatus(303)

    const updated = await dashboard.request.patch(
      `${flagsPath}/${created.data.flag.id}`,
      {
        description: 'Release checkout safely',
        enabled: true,
        rolloutPercentage: 25,
        targets: ['user:42', 'account:acme']
      }
    )
    expect(updated).toHaveStatus(200)
    expect(updated.data.flag.version).toBe(2)

    const appClient = request.withHeaders({
      authorization: `Bearer ${token}`,
      accept: 'application/json'
    })
    const config = await appClient.get(`/api/v1/flags/apps/${app.id}`)
    expect(config).toHaveStatus(200)
    expect(config.data.flags).toEqual([
      {
        key: 'new-checkout',
        enabled: true,
        rolloutPercentage: 25,
        targets: ['account:acme', 'user:42'],
        version: 2
      }
    ])

    const audit = await sails.models.auditlog.findOne({
      action: 'feature_flag.released',
      resourceType: 'feature_flag',
      resourceId: String(created.data.flag.id)
    })
    expect(audit.details.targetCount).toBe(2)
    expect(JSON.stringify(audit).includes('user:42')).toBe(false)

    const wrongToken = await request
      .withHeaders({
        authorization: 'Bearer stk_wrong',
        accept: 'application/json'
      })
      .get(`/api/v1/flags/apps/${app.id}`)
    expect(wrongToken).toHaveStatus(401)

    const killed = await dashboard.request.patch(
      `${flagsPath}/${created.data.flag.id}`,
      {
        description: updated.data.flag.description,
        enabled: false,
        rolloutPercentage: 25,
        targets: updated.data.flag.targets
      }
    )
    expect(killed).toHaveStatus(200)
    expect(killed.data.flag.enabled).toBe(false)
    expect(
      Boolean(
        await sails.models.auditlog.findOne({
          action: 'feature_flag.killed',
          resourceId: String(created.data.flag.id)
        })
      )
    ).toBe(true)

    const deleted = await dashboard.request.delete(
      `${flagsPath}/${created.data.flag.id}`
    )
    expect(deleted).toHaveStatus(200)
    expect(
      (await appClient.get(`/api/v1/flags/apps/${app.id}`)).data.flags
    ).toEqual([])
  }
)
