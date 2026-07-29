module.exports = {
  friendlyName: 'Update Helm snippet',

  description: 'Update a Helm snippet owned by the current user.',

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
    name: {
      type: 'string',
      maxLength: 100
    },
    source: {
      type: 'string'
    },
    scope: {
      type: 'string',
      isIn: ['personal', 'project']
    }
  },

  exits: {
    success: { statusCode: 200 },
    badRequest: { responseType: 'badRequest' },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 }
  },

  fn: async function ({
    projectSlug,
    environmentSlug,
    id,
    name,
    source,
    scope: nextScope
  }) {
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

    const updates = {}
    if (name !== undefined) {
      updates.name = name.trim()
      if (!updates.name) throw { badRequest: 'Give this snippet a name.' }
    }
    if (source !== undefined) {
      if (!source.trim()) throw { badRequest: 'Snippet source is required.' }
      if (Buffer.byteLength(source) > sails.config.custom.helm.maxSourceBytes) {
        throw { badRequest: 'Snippet source is too large.' }
      }
      updates.source = source
    }
    if (nextScope !== undefined) updates.scope = nextScope
    if (Object.keys(updates).length === 0) {
      throw { badRequest: 'No snippet changes were provided.' }
    }

    const effectiveName = updates.name || snippet.name
    const effectiveScope = updates.scope || snippet.scope
    const conflict = await findNameConflict({
      projectId: scope.project.id,
      ownerId: scope.user.id,
      snippetScope: effectiveScope,
      name: effectiveName,
      excludeId: snippet.id
    })
    if (conflict) {
      throw {
        badRequest:
          effectiveScope === 'project'
            ? 'A project snippet already uses this name.'
            : 'You already have a snippet with this name.'
      }
    }

    let updated
    try {
      updated = await HelmSnippet.updateOne({ id: snippet.id }).set(updates)
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw {
          badRequest:
            effectiveScope === 'project'
              ? 'A project snippet already uses this name.'
              : 'You already have a snippet with this name.'
        }
      }
      throw error
    }
    await sails.helpers.audit.log.with({
      action: 'helm.snippet.updated',
      resourceType: 'helmSnippet',
      resourceId: String(updated.id),
      details: {
        projectId: scope.project.id,
        name: updated.name,
        scope: updated.scope
      },
      userId: String(scope.user.id),
      teamId: String(scope.project.team.id),
      ipAddress: this.req.ip
    })

    return {
      snippet: {
        ...updated,
        owner: { id: scope.user.id, name: scope.user.fullName },
        canManage: true
      }
    }
  }
}

async function findNameConflict({
  projectId,
  ownerId,
  snippetScope,
  name,
  excludeId
}) {
  const criteria = {
    project: projectId,
    scope: snippetScope
  }
  if (snippetScope === 'personal') criteria.owner = ownerId

  const candidates = await HelmSnippet.find(criteria)
  const normalized = name.toLocaleLowerCase()
  return candidates.find(
    (snippet) =>
      Number(snippet.id) !== Number(excludeId) &&
      snippet.name.toLocaleLowerCase() === normalized
  )
}

function isUniqueConstraint(error) {
  return (
    error?.code === 'E_UNIQUE' ||
    error?.code === 'SQLITE_CONSTRAINT' ||
    /unique constraint/i.test(error?.message || '')
  )
}
