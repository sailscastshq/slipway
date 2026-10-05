const helmCommand = require('../../../../lib/helm-command')
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
    mode: {
      type: 'string',
      isIn: ['javascript', 'command'],
      defaultsTo: 'javascript'
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

  fn: async function ({ projectSlug, environmentSlug, appSlug, code, mode }) {
    if (Buffer.byteLength(code) > sails.config.custom.helm.maxSourceBytes) {
      throw { badRequest: 'Helm source exceeds the configured size limit.' }
    }
    const scope = await sails.helpers.helm
      .resolveProjectScope(
        this.req.auth?.userId || this.req.session.userId,
        projectSlug,
        environmentSlug,
        appSlug,
        this.req
      )
      .intercept('notFound', 'notFound')
      .intercept('forbidden', 'forbidden')
    if (
      mode === 'command' &&
      !['owner', 'admin'].includes(scope.user.teamRole)
    ) {
      throw 'forbidden'
    }
    let classification
    try {
      classification =
        mode === 'command'
          ? helmCommand.classifyCommand(code, {
              maxBytes: sails.config.custom.helm.maxSourceBytes
            })
          : sails.helpers.helm.classifyMutations(code)
    } catch (error) {
      if (error.code === 'HELM_COMMAND_INVALID')
        return this.res
          .status(400)
          .json({ code: error.code, message: error.message })
      throw error
    }
    const target = sails.helpers.helm.describeTarget(scope)
    const { fingerprint, ...safeTarget } = target

    this.res.set('Cache-Control', 'private, no-store')
    return {
      classification,
      mode,
      sourceHash:
        mode === 'command'
          ? helmCommand.hashCommand(code)
          : sails.helpers.helm.hashSource(code),
      requiresWriteArm:
        Boolean(scope.environment.isProduction) && classification.mutating,
      target: safeTarget
    }
  }
}
