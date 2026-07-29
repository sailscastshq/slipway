module.exports = {
  friendlyName: 'Delete Helm snippet',

  description: 'Delete a Helm snippet owned by the current user.',

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
    const snippet = await HelmSnippet.findOne({
      id,
      project: scope.project.id
    })
    if (!snippet) throw 'notFound'
    if (Number(snippet.owner) !== Number(scope.user.id)) throw 'forbidden'

    await HelmSnippet.destroyOne({ id: snippet.id })
    await sails.helpers.audit.log.with({
      action: 'helm.snippet.deleted',
      resourceType: 'helmSnippet',
      resourceId: String(snippet.id),
      details: {
        projectId: scope.project.id,
        name: snippet.name,
        scope: snippet.scope
      },
      userId: String(scope.user.id),
      teamId: String(scope.project.team.id),
      ipAddress: this.req.ip
    })

    return { deleted: true }
  }
}
