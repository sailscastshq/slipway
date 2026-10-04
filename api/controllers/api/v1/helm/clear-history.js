module.exports = {
  friendlyName: 'Clear Helm history',

  description:
    'Clear owned Helm history for an environment while preserving pinned entries by default.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    mode: {
      type: 'string',
      isIn: ['javascript', 'command'],
      defaultsTo: 'javascript'
    },
    appSlug: { type: 'string' },
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
    success: { responseType: 'mutationSuccess' },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 }
  },

  fn: async function ({
    projectSlug,
    environmentSlug,
    includePinned,
    mode,
    appSlug
  }) {
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
    const criteria = {
      mode,
      user: scope.user.id,
      project: scope.project.id,
      environment: scope.environment.id
    }
    if (mode === 'command') criteria.app = scope.app.id
    if (!includePinned) criteria.pinned = false

    const deleted = await HelmHistoryEntry.destroy(criteria).fetch()
    await sails.helpers.audit.log.with({
      action: 'helm.history.cleared',
      resourceType: 'environment',
      resourceId: String(scope.environment.id),
      details: {
        projectId: scope.project.id,
        mode,
        appId: mode === 'command' ? scope.app.id : null,
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
