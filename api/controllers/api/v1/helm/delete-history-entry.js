module.exports = {
  friendlyName: 'Delete Helm history entry',

  description:
    'Delete one owned Helm history entry without touching audit logs.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      required: true
    },
    id: {
      type: 'number',
      required: true
    }
  },

  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 }
  },

  fn: async function ({ projectSlug, environmentSlug, id }) {
    const scope = await sails.helpers.helm
      .resolveProjectScope(
        this.req.session.userId,
        projectSlug,
        environmentSlug
      )
      .intercept('notFound', 'notFound')
      .intercept('forbidden', 'forbidden')
    const deleted = await HelmHistoryEntry.destroyOne({
      id,
      user: scope.user.id,
      project: scope.project.id,
      environment: scope.environment.id
    })

    if (!deleted) throw 'notFound'
    return { deleted: true }
  }
}
