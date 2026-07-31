module.exports = {
  friendlyName: 'Destroy release flag',

  description: 'Remove a retired release flag.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    flagId: { type: 'string', required: true }
  },

  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 }
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
    const flag = await FeatureFlag.destroyOne({
      id: inputs.flagId,
      environment: context.environment.id,
      app: context.app.id
    })
    if (!flag) throw 'notFound'

    await sails.helpers.audit.log.with({
      action: 'feature_flag.deleted',
      resourceType: 'feature_flag',
      resourceId: String(flag.id),
      details: {
        key: flag.key,
        projectSlug: context.project.slug,
        environmentSlug: context.environment.slug,
        appSlug: context.app.slug,
        version: flag.version
      },
      userId: String(context.user.id),
      teamId: String(context.project.team),
      ipAddress: this.req.ip
    })

    return { deleted: true }
  }
}
