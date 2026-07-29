module.exports = {
  friendlyName: 'Update Helm history entry',

  description: 'Pin or unpin an owned Helm history entry.',

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
    },
    pinned: {
      type: 'boolean',
      required: true
    }
  },

  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 }
  },

  fn: async function ({ projectSlug, environmentSlug, id, pinned }) {
    const scope = await sails.helpers.helm
      .resolveProjectScope(
        this.req.session.userId,
        projectSlug,
        environmentSlug
      )
      .intercept('notFound', 'notFound')
      .intercept('forbidden', 'forbidden')
    const entry = await HelmHistoryEntry.updateOne({
      id,
      user: scope.user.id,
      project: scope.project.id,
      environment: scope.environment.id
    }).set({ pinned })

    if (!entry) throw 'notFound'

    return {
      entry: {
        id: entry.id,
        pinned: entry.pinned
      }
    }
  }
}
