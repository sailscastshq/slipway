module.exports = {
  friendlyName: 'Create release flag',

  description: 'Create a boolean release flag for one deployed app.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    key: { type: 'string', required: true },
    description: { type: 'string', allowNull: true },
    enabled: { type: 'boolean', defaultsTo: false },
    rolloutPercentage: { type: 'number', defaultsTo: 0 },
    targets: { type: 'json', defaultsTo: [] }
  },

  exits: {
    success: { statusCode: 201 },
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
    const normalized = sails.helpers.flag.normalizeDefinition.with({
      values: inputs,
      requireKey: true
    })
    if (normalized.problems.length > 0) {
      throw { badRequest: { problems: normalized.problems } }
    }

    if (
      await FeatureFlag.findOne({
        environment: context.environment.id,
        app: context.app.id,
        key: normalized.values.key
      })
    ) {
      throw {
        badRequest: {
          problems: [{ key: 'A release flag with this key already exists.' }]
        }
      }
    }

    if (
      (await FeatureFlag.count({
        environment: context.environment.id,
        app: context.app.id
      })) >= 100
    ) {
      throw {
        badRequest: {
          problems: [{ key: 'An app can have at most 100 release flags.' }]
        }
      }
    }

    const flag = await FeatureFlag.create({
      ...normalized.values,
      environment: context.environment.id,
      app: context.app.id,
      changedBy: context.user.id,
      changedByName: context.user.fullName
    }).fetch()

    await sails.helpers.audit.log.with({
      action: 'feature_flag.created',
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
