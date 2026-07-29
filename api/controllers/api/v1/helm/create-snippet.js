module.exports = {
  friendlyName: 'Create Helm snippet',

  description: 'Save source as an inert personal or project Helm snippet.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      required: true
    },
    name: {
      type: 'string',
      required: true,
      maxLength: 100
    },
    source: {
      type: 'string',
      required: true
    },
    scope: {
      type: 'string',
      isIn: ['personal', 'project'],
      defaultsTo: 'personal'
    }
  },

  exits: {
    success: { statusCode: 201 },
    badRequest: { responseType: 'badRequest' },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 }
  },

  fn: async function ({
    projectSlug,
    environmentSlug,
    name,
    source,
    scope: snippetScope
  }) {
    const scope = await sails.helpers.helm
      .resolveProjectScope(
        this.req.session.userId,
        projectSlug,
        environmentSlug
      )
      .intercept('notFound', 'notFound')
      .intercept('forbidden', 'forbidden')
    const normalizedName = name.trim()
    const normalizedSource = source.trim()

    if (!normalizedName) throw { badRequest: 'Give this snippet a name.' }
    if (!normalizedSource) throw { badRequest: 'Snippet source is required.' }
    if (Buffer.byteLength(source) > sails.config.custom.helm.maxSourceBytes) {
      throw { badRequest: 'Snippet source is too large.' }
    }

    const conflict = await findNameConflict({
      projectId: scope.project.id,
      ownerId: scope.user.id,
      snippetScope,
      name: normalizedName
    })
    if (conflict) {
      throw {
        badRequest:
          snippetScope === 'project'
            ? 'A project snippet already uses this name.'
            : 'You already have a snippet with this name.'
      }
    }

    let snippet
    try {
      snippet = await HelmSnippet.create({
        name: normalizedName,
        source,
        scope: snippetScope,
        owner: scope.user.id,
        team: scope.project.team.id,
        project: scope.project.id
      }).fetch()
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw {
          badRequest:
            snippetScope === 'project'
              ? 'A project snippet already uses this name.'
              : 'You already have a snippet with this name.'
        }
      }
      throw error
    }

    await sails.helpers.audit.log.with({
      action: 'helm.snippet.created',
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

    return {
      snippet: {
        ...snippet,
        owner: { id: scope.user.id, name: scope.user.fullName },
        canManage: true
      }
    }
  }
}

async function findNameConflict({ projectId, ownerId, snippetScope, name }) {
  const criteria = {
    project: projectId,
    scope: snippetScope
  }
  if (snippetScope === 'personal') criteria.owner = ownerId

  const candidates = await HelmSnippet.find(criteria)
  const normalized = name.toLocaleLowerCase()
  return candidates.find(
    (snippet) => snippet.name.toLocaleLowerCase() === normalized
  )
}

function isUniqueConstraint(error) {
  return (
    error?.code === 'E_UNIQUE' ||
    error?.code === 'SQLITE_CONSTRAINT' ||
    /unique constraint/i.test(error?.message || '')
  )
}
