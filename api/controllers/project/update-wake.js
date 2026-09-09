module.exports = {
  friendlyName: 'Update Wake settings',
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    enabled: { type: 'boolean', required: true },
    settings: { type: 'ref', required: true }
  },
  exits: {
    forbidden: { statusCode: 403 },
    unavailable: { statusCode: 503 },
    badRequest: { statusCode: 400 }
  },
  fn: async function ({ slug, envSlug, appSlug, enabled, settings }) {
    if (
      !settings ||
      typeof settings !== 'object' ||
      Array.isArray(settings) ||
      Object.keys(settings).some(
        (k) =>
          ![
            'mode',
            'allowedOrigins',
            'requireConsent',
            'respectPrivacySignals',
            'excludedPaths'
          ].includes(k)
      )
    )
      throw 'badRequest'
    const normalized =
      require('../../../packages/hook/lib/wake-contract').settings(settings)
    if (
      !['first-party', 'cookieless'].includes(settings.mode) ||
      !Array.isArray(settings.allowedOrigins) ||
      !Array.isArray(settings.excludedPaths) ||
      normalized.allowedOrigins.length !==
        new Set(settings.allowedOrigins).size ||
      normalized.excludedPaths.length !== settings.excludedPaths.length ||
      typeof settings.requireConsent !== 'boolean' ||
      typeof settings.respectPrivacySignals !== 'boolean'
    )
      throw 'badRequest'
    try {
      return await sails.helpers.wake.setEnabled.with({
        req: this.req,
        projectSlug: slug,
        envSlug,
        appSlug,
        enabled,
        settings
      })
    } catch (error) {
      throw ['forbidden', 'notFound'].includes(error.code)
        ? 'forbidden'
        : 'unavailable'
    }
  }
}
