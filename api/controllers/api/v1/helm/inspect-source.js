module.exports = {
  friendlyName: 'Inspect Helm source',

  description:
    'Classify project Helm source against its current target before the UI attempts execution.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      required: true
    },
    appSlug: {
      type: 'string'
    },
    code: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: { statusCode: 200 },
    badRequest: { responseType: 'badRequest' },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 }
  },

  fn: async function ({ projectSlug, environmentSlug, appSlug, code }) {
    if (Buffer.byteLength(code) > sails.config.custom.helm.maxSourceBytes) {
      throw { badRequest: 'Helm source exceeds the configured size limit.' }
    }
    const scope = await sails.helpers.helm
      .resolveProjectScope(
        this.req.session.userId,
        projectSlug,
        environmentSlug,
        appSlug
      )
      .intercept('notFound', 'notFound')
      .intercept('forbidden', 'forbidden')
    const classification = sails.helpers.helm.classifyMutations(code)
    const target = sails.helpers.helm.describeTarget(scope)
    const { fingerprint, ...safeTarget } = target

    this.res.set('Cache-Control', 'private, no-store')
    return {
      classification,
      sourceHash: sails.helpers.helm.hashSource(code),
      requiresWriteArm:
        Boolean(scope.environment.isProduction) && classification.mutating,
      target: safeTarget
    }
  }
}
