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

    expect(response).toHaveStatus(200)
    expect(JSON.stringify(response.data).includes(secret)).toBe(false)
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

    const response = await dashboard.request.patch(path, {
      envVars: {
        DATABASE_URL: managedValue,
        SENTRY_DSN: 'https://sentry.example/123'
      },
      envVarMetadata: normalizedPageMetadata
    })

    expect(response).toHaveStatus(200)
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

    expect(response).toHaveStatus(409)
    expect(response).toHaveHeader('x-inertia-location', '/settings/global-env')
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
