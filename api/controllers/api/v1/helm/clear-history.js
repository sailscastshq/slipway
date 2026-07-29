module.exports = {
  friendlyName: 'Clear Helm history',

  description:
    'Clear owned Helm history for an environment while preserving pinned entries by default.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      required: true
    },
    includePinned: {
      type: 'boolean',
      defaultsTo: false
    }
  },

  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 }
  },

  fn: async function ({ projectSlug, environmentSlug, includePinned }) {
    const scope = await sails.helpers.helm
      .resolveProjectScope(
        this.req.session.userId,
        projectSlug,
        environmentSlug
      )
      .intercept('notFound', 'notFound')
      .intercept('forbidden', 'forbidden')
    const criteria = {
      user: scope.user.id,
      project: scope.project.id,
      environment: scope.environment.id
    }
    if (!includePinned) criteria.pinned = false

    const deleted = await HelmHistoryEntry.destroy(criteria).fetch()
    await sails.helpers.audit.log.with({
      action: 'helm.history.cleared',
      resourceType: 'environment',
      resourceId: String(scope.environment.id),
      details: {
        projectId: scope.project.id,
        includePinned,
        deletedCount: deleted.length
      },
      userId: String(scope.user.id),
      teamId: String(scope.project.team.id),
      ipAddress: this.req.ip
    })

    return { deletedCount: deleted.length }
  }
}
