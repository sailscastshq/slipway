module.exports = {
  friendlyName: 'Update release flag',

  description:
    'Update rollout rules or use the master switch without redeploying.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    flagId: { type: 'string', required: true },
    description: { type: 'string', allowNull: true },
    enabled: { type: 'boolean', required: true },
    rolloutPercentage: { type: 'number', required: true },
    targets: { type: 'json', required: true }
  },

  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    badRequest: { responseType: 'badRequest' }
  },

  fn: async function (inputs) {
    const context = await sails.helpers.flag.resolveApp
      .with({
        userId: String(this.req.session.userId),
        projectSlug: inputs.projectSlug,
        environmentSlug: inputs.environmentSlug,
        appSlug: inputs.appSlug
      })
      .intercept('notFound', 'notFound')
    const current = await FeatureFlag.findOne({
      id: inputs.flagId,
      environment: context.environment.id,
      app: context.app.id
    })
    if (!current) throw 'notFound'

    const normalized = sails.helpers.flag.normalizeDefinition.with({
      values: inputs
    })
    if (normalized.problems.length > 0) {
      throw { badRequest: { problems: normalized.problems } }
    }

    const flag = await FeatureFlag.updateOne({ id: current.id }).set({
      ...normalized.values,
      version: Number(current.version || 1) + 1,
      changedBy: context.user.id,
      changedByName: context.user.fullName
    })

    await sails.helpers.audit.log.with({
      action:
        current.enabled !== true && flag.enabled === true
          ? 'feature_flag.released'
          : current.enabled === true && flag.enabled !== true
          ? 'feature_flag.killed'
          : 'feature_flag.updated',
      resourceType: 'feature_flag',
      resourceId: String(flag.id),
      details: auditDetails(flag, context),
      userId: String(context.user.id),
      teamId: String(context.project.team),
      ipAddress: this.req.ip
    })

    return { flag: sails.helpers.flag.present(flag) }
  }
}

function auditDetails(flag, context) {
  return {
    key: flag.key,
    projectSlug: context.project.slug,
    environmentSlug: context.environment.slug,
    appSlug: context.app.slug,
    enabled: flag.enabled === true,
    rolloutPercentage: flag.rolloutPercentage,
    targetCount: flag.targets.length,
    version: flag.version
  }
}
