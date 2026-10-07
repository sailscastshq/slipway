const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'app secrets are encrypted and configuration audits never retain their values',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'encrypted-app-secrets',
          name: 'Encrypted app secrets'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const app = current.apps.web
    const secret = 'never-write-this-value-to-an-audit-log'
    const dashboard = await withCsrfFromPage(
      request,
      `/projects/encrypted-app-secrets/environments/production/apps/${app.slug}`,
      'genesisUser'
    )

    const response = await dashboard.request.patch(
      `/api/v1/projects/encrypted-app-secrets/environments/production/apps/${app.slug}`,
      {
        envVars: { APP_SECRET: secret },
        envVarMetadata: {
          APP_SECRET: {
            kind: 'secret',
            previewPolicy: 'randomize',
            description: 'Application signing secret'
          }
        }
      }
    )

    expect(response).toHaveStatus(303)
    expect(JSON.stringify(response.data || {}).includes(secret)).toBe(false)
    const persisted = await sails.models.app.findOne({ id: app.id }).decrypt()
    expect(persisted.secureEnvVars.APP_SECRET).toBe(secret)
    expect(persisted.envVars).toEqual({})
    expect(persisted.envVarMetadata.APP_SECRET.kind).toBe('secret')
    expect(persisted.envVarMetadata.APP_SECRET.previewPolicy).toBe('randomize')

    const audit = await sails.models.auditlog.findOne({
      action: 'configuration.created',
      resourceType: 'app',
      resourceId: String(app.id)
    })
    expect(audit.details.key).toBe('APP_SECRET')
    expect(JSON.stringify(audit).includes(secret)).toBe(false)
  }
)

test(
  'managed service variables cannot be changed through the environment API',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'managed-environment-secrets',
          name: 'Managed environment secrets'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const environment = current.environments.production
    await sails.models.environment.updateOne({ id: environment.id }).set({
      envVars: { DATABASE_URL: 'postgresql://managed' },
      envVarMetadata: {
        DATABASE_URL: {
          kind: 'secret',
          managed: true,
          previewPolicy: 'omit'
        }
      }
    })
    await world.create('service').with({
      name: 'main-db',
      environment: environment.id,
      envVarKey: 'DATABASE_URL'
    })
    const dashboard = await withCsrfFromPage(
      request,
      '/projects/managed-environment-secrets/environments/production',
      'genesisUser'
    )

    const response = await dashboard.request.patch(
      '/api/v1/projects/managed-environment-secrets/environments/production',
      {
        envVars: { DATABASE_URL: 'postgresql://managed' },
        envVarMetadata: {
          DATABASE_URL: { kind: 'plain', previewPolicy: 'inherit' }
        }
      }
    )

    expect(response).toHaveStatus(303)
    const persisted = await sails.models.environment
      .findOne({ id: environment.id })
      .decrypt()
    expect(persisted.envVars.DATABASE_URL).toBe('postgresql://managed')
    expect(persisted.envVarMetadata.DATABASE_URL.managed).toBe(true)

    const appResponse = await dashboard.request.patch(
      '/api/v1/projects/managed-environment-secrets/environments/production/apps/web',
      {
        envVars: { DATABASE_URL: 'postgresql://app-shadow' },
        envVarMetadata: {
          DATABASE_URL: { kind: 'secret', previewPolicy: 'omit' }
        }
      }
    )
    expect(appResponse).toHaveStatus(303)
  }
)

test(
  'unrelated variables can change alongside unchanged legacy managed metadata',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'legacy-managed-environment-secrets',
          name: 'Legacy managed environment secrets'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const environment = world.current.environments.production
    const managedValue = 'postgresql://legacy-managed'
    await sails.models.environment.updateOne({ id: environment.id }).set({
      envVars: { DATABASE_URL: managedValue },
      envVarMetadata: {}
    })
    await world.create('service').with({
      name: 'legacy-main-db',
      environment: environment.id,
      envVarKey: 'DATABASE_URL'
    })
    const dashboard = await withCsrfFromPage(
      request,
      '/projects/legacy-managed-environment-secrets/environments/production',
      'genesisUser'
    )
    const path =
      '/api/v1/projects/legacy-managed-environment-secrets/environments/production'
    const normalizedPageMetadata = {
      DATABASE_URL: {
        kind: 'secret',
        managed: true,
        previewPolicy: 'omit'
      },
      SENTRY_DSN: {
        kind: 'secret',
        previewPolicy: 'omit'
      }
    }
    expect(dashboard.page.data.props.envVarMetadata.DATABASE_URL).toEqual({
      kind: 'secret',
      managed: true,
      previewPolicy: 'omit'
    })

    const response = await dashboard.request.patch(path, {
      envVars: {
        DATABASE_URL: managedValue,
        SENTRY_DSN: 'https://sentry.example/123'
      },
      envVarMetadata: normalizedPageMetadata
    })

    expect(response).toHaveStatus(303)
    let persisted = await sails.models.environment
      .findOne({ id: environment.id })
      .decrypt()
    expect(persisted.envVars.DATABASE_URL).toBe(managedValue)
    expect(persisted.envVarMetadata.DATABASE_URL).toEqual({
      kind: 'secret',
      managed: true,
      previewPolicy: 'omit'
    })
    expect(persisted.envVarMetadata.SENTRY_DSN.changedAt > 0).toBe(true)
    expect(persisted.envVarMetadata.SENTRY_DSN.changedBy).toBe(
      String(world.current.users.genesisUser.id)
    )
    expect(persisted.envVarMetadata.SENTRY_DSN.changedByName).toBe(
      world.current.users.genesisUser.fullName
    )
    const metadataAfterVariableUpdate = persisted.envVarMetadata

    const unrelatedUpdate = await dashboard.request.patch(path, {
      name: 'Production launch'
    })
    expect(unrelatedUpdate).toHaveStatus(303)
    persisted = await sails.models.environment
      .findOne({ id: environment.id })
      .decrypt()
    expect(persisted.envVarMetadata).toEqual(metadataAfterVariableUpdate)

    const configurationAudits = await sails.models.auditlog.find({
      resourceType: 'environment',
      resourceId: String(environment.id),
      action: { startsWith: 'configuration.' }
    })
    expect(configurationAudits.map((audit) => audit.details.key)).toEqual([
      'SENTRY_DSN'
    ])
    expect(JSON.stringify(configurationAudits).includes(managedValue)).toBe(
      false
    )

    const valueChange = await dashboard.request.patch(path, {
      envVars: {
        DATABASE_URL: 'postgresql://forbidden-change',
        SENTRY_DSN: 'https://sentry.example/123'
      },
      envVarMetadata: normalizedPageMetadata
    })
    const policyChange = await dashboard.request.patch(path, {
      envVars: {
        DATABASE_URL: managedValue,
        SENTRY_DSN: 'https://sentry.example/123'
      },
      envVarMetadata: {
        ...normalizedPageMetadata,
        DATABASE_URL: {
          ...normalizedPageMetadata.DATABASE_URL,
          kind: 'plain'
        }
      }
    })

    expect(valueChange).toHaveStatus(303)
    expect(policyChange).toHaveStatus(303)
    persisted = await sails.models.environment
      .findOne({ id: environment.id })
      .decrypt()
    expect(persisted.envVars.DATABASE_URL).toBe(managedValue)
    expect(persisted.envVarMetadata.DATABASE_URL.kind).toBe('secret')
    expect(
      await sails.models.auditlog.count({
        resourceType: 'environment',
        resourceId: String(environment.id),
        action: { startsWith: 'configuration.' }
      })
    ).toBe(1)
  }
)

test(
  'global configuration changes retain metadata and write value-free audits',
  { world: 'configured-slipway' },
  async ({ sails, request, expect }) => {
    const secret = 'global-secret-that-must-not-enter-the-audit-log'
    const dashboard = await withCsrfFromPage(
      request,
      '/settings/global-env',
      'genesisUser'
    )

    const response = await dashboard.request.patch('/settings/global-env', {
      envVars: { GLOBAL_SIGNING_KEY: secret },
      envVarMetadata: {
        GLOBAL_SIGNING_KEY: { kind: 'secret', previewPolicy: 'omit' }
      }
    })

    expect(response).toHaveStatus(303)
    expect(response).toHaveHeader('location', '/settings/global-env')
    const values = JSON.parse(
      await sails.helpers.setting.get('globalEnvVars', '{}')
    )
    const metadata = JSON.parse(
      await sails.helpers.setting.get('globalEnvVarMetadata', '{}')
    )
    expect(values.GLOBAL_SIGNING_KEY).toBe(secret)
    expect(metadata.GLOBAL_SIGNING_KEY.previewPolicy).toBe('omit')

    const audit = await sails.models.auditlog.findOne({
      action: 'configuration.created',
      resourceType: 'setting',
      resourceId: 'globalEnvVars'
    })
    expect(audit.details.key).toBe('GLOBAL_SIGNING_KEY')
    expect(JSON.stringify(audit).includes(secret)).toBe(false)
  }
)

test(
  'preview environments apply explicit per-variable inheritance policies',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'preview-config-policy',
          name: 'Preview config policy'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const environment = world.current.environments.production
    await sails.models.environment.updateOne({ id: environment.id }).set({
      envVars: {
        OMITTED_SECRET: 'production-only',
        RANDOM_SECRET: 'production-random-source',
        PUBLIC_MODE: 'staging'
      },
      envVarMetadata: {
        OMITTED_SECRET: { kind: 'secret', previewPolicy: 'omit' },
        RANDOM_SECRET: { kind: 'secret', previewPolicy: 'randomize' },
        PUBLIC_MODE: { kind: 'plain', previewPolicy: 'inherit' }
      }
    })
    const dashboard = await withCsrfFromPage(
      request,
      '/projects/preview-config-policy/environments/production',
      'genesisUser'
    )

    const response = await dashboard.request.post(
      '/api/v1/projects/preview-config-policy/environments',
      {
        name: 'Preview 42',
        sourceEnvironmentSlug: 'production'
      }
    )

    expect(response).toHaveStatus(201)
    const preview = await sails.models.environment
      .findOne({ project: environment.project, slug: 'preview-42' })
      .decrypt()
    expect(preview.envVars.OMITTED_SECRET).toBe(undefined)
    expect(preview.envVars.RANDOM_SECRET === 'production-random-source').toBe(
      false
    )
    expect(preview.envVars.PUBLIC_MODE).toBe('staging')
    expect(preview.envVarMetadata.RANDOM_SECRET.previewPolicy).toBe('randomize')
  }
)

test(
  'ordinary APIs and page props hide arbitrary secrets, while masked CLI edits preserve and rename them',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'safe-diagnostics' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const environment = world.current.environments.production
    const app = world.current.apps.web
    const canary = 'ordinary-secret-canary-718-<>&'
    await sails.models.environment.updateOne({ id: environment.id }).set({
      envVars: {
        UNUSUAL: canary,
        REMOVE: 'another-secret-718',
        MODE: 'production'
      },
      envVarMetadata: { MODE: { kind: 'plain', previewPolicy: 'inherit' } }
    })
    await sails.models.app.updateOne({ id: app.id }).set({
      secureEnvVars: { OTHER: 'nested-app-secret-718' },
      bridgeSecret: 'bridge-secret-718'
    })
    const path = '/api/v1/projects/safe-diagnostics/environments/production'
    const browser = await withCsrfFromPage(
      request,
      '/projects/safe-diagnostics/environments/production',
      'genesisUser'
    )
    expect(browser.page.data.props.envVars.UNUSUAL).toBe('[REDACTED]')
    expect(browser.page.data.props.envVars.MODE).toBe('production')
    for (const url of [
      path,
      '/api/v1/projects/safe-diagnostics/environments',
      path + '/apps'
    ]) {
      const response = await browser.request.get(url)
      expect(response).toHaveStatus(200)
      const serialized = JSON.stringify(response.data)
      expect(serialized.includes(canary)).toBe(false)
      expect(serialized.includes('nested-app-secret-718')).toBe(false)
      expect(serialized.includes('bridge-secret-718')).toBe(false)
      expect(serialized.includes('encryptedValue')).toBe(false)
    }
    const response = await browser.request.get(path)
    expect(response.data.environment.envVars.UNUSUAL).toBe('[REDACTED]')
    // The existing CLI reads, edits, and writes the whole map without metadata.
    const next = {
      ...response.data.environment.envVars,
      ADDED: 'new-cli-secret-718'
    }
    delete next.REMOVE
    expect(await browser.request.patch(path, { envVars: next })).toHaveStatus(
      303
    )
    let persisted = await sails.models.environment
      .findOne({ id: environment.id })
      .decrypt()
    expect(persisted.envVars.UNUSUAL).toBe(canary)
    expect(persisted.envVars.ADDED).toBe('new-cli-secret-718')
    expect(Object.hasOwn(persisted.envVars, 'REMOVE')).toBe(false)
    expect(
      await browser.request.patch(path, {
        envVars: {
          RENAMED: '[REDACTED]',
          ADDED: '[REDACTED]',
          MODE: 'production'
        },
        envVarRenames: { UNUSUAL: 'RENAMED' }
      })
    ).toHaveStatus(303)
    persisted = await sails.models.environment
      .findOne({ id: environment.id })
      .decrypt()
    expect(persisted.envVars.RENAMED).toBe(canary)
    expect(Object.hasOwn(persisted.envVars, 'UNUSUAL')).toBe(false)
    const deployment = await world
      .create('deployment')
      .with({ environment: environment.id, app: app.id })
    await sails.models.deployment.appendBuildLog(
      deployment.id,
      `failed: ${canary}\n`
    )
    const log = await sails.models.deployment.findOne({ id: deployment.id })
    expect(log.buildLogs.includes(canary)).toBe(false)
    expect(log.buildLogs.includes('[REDACTED]')).toBe(true)
  }
)

test(
  'explicit reveals are scoped, audited, uncached and revoked with administrator membership',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'audited-reveal' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const environment = world.current.environments.production
    const canary = 'reveal-only-secret-718'
    await sails.models.environment
      .updateOne({ id: environment.id })
      .set({ envVars: { UNUSUAL: canary } })
    const browser = await withCsrfFromPage(request, '/settings', 'genesisUser')
    const reveal = () =>
      browser.request.post('/api/v1/configuration/reveal', {
        scope: 'environment',
        id: String(environment.id),
        key: 'UNUSUAL'
      })
    const response = await reveal()
    expect(response).toHaveStatus(200)
    expect(response.data.value).toBe(canary)
    expect(response).toHaveHeader('cache-control', 'private, no-store')
    const audit = await sails.models.auditlog.findOne({
      action: 'configuration.revealed',
      resourceId: String(environment.id)
    })
    expect(audit.details).toEqual({ key: 'UNUSUAL' })
    expect(JSON.stringify(audit).includes(canary)).toBe(false)
    const crypto = require('node:crypto')
    const member = await world
      .create('user')
      .with({ team: world.current.teams.genesisTeam.id, teamRole: 'admin' })
    const rawToken = crypto.randomBytes(32).toString('hex')
    await sails.models.clitoken.create({
      user: member.id,
      team: member.team,
      token: crypto.createHash('sha256').update(rawToken).digest('hex')
    })
    const memberRequest = browser.request.withHeaders({
      authorization: `Bearer sl_${rawToken}`
    })
    const payload = {
      scope: 'environment',
      id: String(environment.id),
      key: 'UNUSUAL'
    }
    expect(
      await memberRequest.post('/api/v1/configuration/reveal', payload)
    ).toHaveStatus(200)
    const membership = await sails.models.teammembership.findOne({
      user: member.id,
      team: member.team
    })
    await sails.models.teammembership
      .updateOne({ id: membership.id })
      .set({ role: 'member' })
    const denied = await memberRequest.post(
      '/api/v1/configuration/reveal',
      payload
    )
    expect(denied).toHaveStatus(403)
    expect(JSON.stringify(denied.data).includes(canary)).toBe(false)
  }
)

test(
  'reveal fails closed on a missing audit and hides foreign-team resources',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'reveal-fail-closed' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const environment = world.current.environments.production
    const secret = 'audit-failure-canary-718'
    await sails.models.environment
      .updateOne({ id: environment.id })
      .set({ envVars: { CANARY: secret } })
    const browser = await withCsrfFromPage(request, '/settings', 'genesisUser')
    const createAudit = sails.models.auditlog.create
    try {
      sails.models.auditlog.create = () => {
        throw new Error(secret)
      }
      const response = await browser.request.post(
        '/api/v1/configuration/reveal',
        { scope: 'environment', id: String(environment.id), key: 'CANARY' }
      )
      expect(response).toHaveStatus(503)
      expect(JSON.stringify(response.data || {}).includes(secret)).toBe(false)
      expect(response).toHaveHeader('cache-control', 'private, no-store')
    } finally {
      sails.models.auditlog.create = createAudit
    }
    const foreign = await world
      .create('team')
      .with({ name: 'Other tenant', owner: world.current.users.genesisUser.id })
    const project = await world
      .create('project')
      .with({ team: foreign.id, slug: 'foreign-reveal' })
    const other = await world
      .create('environment')
      .with({ project: project.id, envVars: { CANARY: secret } })
    const denied = await browser.request.post('/api/v1/configuration/reveal', {
      scope: 'environment',
      id: String(other.id),
      key: 'CANARY'
    })
    expect(denied).toHaveStatus(404)
    expect(JSON.stringify(denied.data || {}).includes(secret)).toBe(false)
  }
)
