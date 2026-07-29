module.exports = {
  friendlyName: 'List Helm snippets',

  description:
    'List personal and project-shared snippets visible to the current user.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      required: true
    },
    q: {
      type: 'string',
      maxLength: 200
    }
  },

  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 }
  },

  fn: async function ({ projectSlug, environmentSlug, q }) {
    const scope = await sails.helpers.helm
      .resolveProjectScope(
        this.req.session.userId,
        projectSlug,
        environmentSlug
      )
      .intercept('notFound', 'notFound')
      .intercept('forbidden', 'forbidden')
    const search = (q || '').trim()
    const visibility = [
      { scope: 'personal', owner: scope.user.id },
      { scope: 'project' }
    ]
    const criteria = {
      project: scope.project.id,
      or: visibility
    }

    let snippets = await HelmSnippet.find(criteria)
      .populate('owner')
      .sort(['scope ASC', 'name ASC'])
    if (search) {
      const query = search.toLocaleLowerCase()
      snippets = snippets.filter(
        (snippet) =>
          snippet.name.toLocaleLowerCase().includes(query) ||
          snippet.source.toLocaleLowerCase().includes(query)
      )
    }

    this.res.set('Cache-Control', 'private, no-store')
    return {
      snippets: snippets.map((snippet) =>
        serializeSnippet(snippet, scope.user.id)
      )
    }
  }
}

function serializeSnippet(snippet, userId) {
  const ownerId =
    snippet.owner && typeof snippet.owner === 'object'
      ? snippet.owner.id
      : snippet.owner
  return {
    id: snippet.id,
    name: snippet.name,
    source: snippet.source,
    scope: snippet.scope,
    owner: {
      id: ownerId,
      name:
        snippet.owner && typeof snippet.owner === 'object'
          ? snippet.owner.fullName
          : 'Unknown'
    },
    canManage: Number(ownerId) === Number(userId),
    createdAt: snippet.createdAt,
    updatedAt: snippet.updatedAt
  }
}
