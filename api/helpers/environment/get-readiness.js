const path = require('node:path')
const crypto = require('node:crypto')
const readiness = require('../../lib/deployment-readiness')

module.exports = {
  friendlyName: 'Get deployment readiness',
  description:
    'Inspect the exact available source and effective configuration without executing app code.',
  inputs: {
    environmentId: { type: 'string', required: true },
    appId: { type: 'string' },
    runtimeValues: {
      type: 'ref',
      description: 'Server-owned resolved deployment configuration'
    },
    appConfiguration: {
      type: 'ref',
      description: 'Server-owned selected app configuration'
    },
    contextPath: {
      type: 'string',
      description: 'Server-owned deployment snapshot path'
    }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({
    environmentId,
    appId,
    contextPath,
    runtimeValues,
    appConfiguration
  }) {
    const environment = await Environment.findOne({ id: environmentId })
      .populate('project')
      .populate('services')
    if (!environment) throw new Error('Environment not found')
    let app = appId
      ? await App.findOne({ id: appId, environment: environment.id })
      : (await App.findOne({ environment: environment.id, isDefault: true })) ||
        (await App.findOne({ environment: environment.id }))
    if (appId && !app) throw new Error('App not found in this environment')
    if (appConfiguration) app = appConfiguration
    const configuration =
      await sails.helpers.configuration.resolveRuntimeConfig.with({
        environmentId,
        ...(app ? { appId: app.id } : {})
      })
    const key = sails.config.models.dataEncryptionKeys.default
    const source = await readiness.inspectSource(
      contextPath ||
        path.join(sails.config.custom.slipwayAppsDir, environment.project.slug),
      key
    )
    let lastProbe
    try {
      lastProbe = JSON.parse(
        await sails.helpers.setting.get(
          `readiness-health-${app?.id || environment.id}`,
          'null'
        )
      )
    } catch {}
    return {
      ...readiness.report({
        source,
        env: runtimeValues || configuration.values,
        services: environment.services,
        dockerfile:
          app?.dockerfilePath ||
          environment.project.dockerfilePath ||
          'Dockerfile',
        healthPath: App.normalizeHealthPath(app?.healthPath),
        production: environment.isProduction,
        lastProbe,
        fingerprint: (value) =>
          crypto
            .createHmac('sha256', key)
            .update(JSON.stringify(value))
            .digest('hex')
      }),
      appId: app?.id || null,
      appName: app?.name || null,
      environmentId: environment.id
    }
  }
}
