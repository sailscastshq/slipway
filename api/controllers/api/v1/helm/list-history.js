module.exports = {
  friendlyName: 'List Helm history',

  description:
    'List searchable execution metadata for the current user and Helm environment.',

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
    const criteria = {
      user: scope.user.id,
      project: scope.project.id,
      environment: scope.environment.id
    }
    if (search) criteria.source = { contains: search }

    const entries = await HelmHistoryEntry.find(criteria)
      .sort(['pinned DESC', 'executedAt DESC', 'id DESC'])
      .limit(sails.config.custom.helm.historyMaxEntriesPerScope)

    this.res.set('Cache-Control', 'private, no-store')
    return {
      entries: entries.map(serializeEntry),
      retentionDays: Math.round(
        sails.config.custom.helm.historyRetentionMs / (24 * 60 * 60 * 1000)
      )
    }
  }
}

function serializeEntry(entry) {
  return {
    id: entry.id,
    source: entry.source,
    status: entry.status,
    durationMs: entry.durationMs,
    executedAt: entry.executedAt,
    target: entry.target,
    targetContext: entry.targetContext,
    targetLabel: formatTarget(entry),
    pinned: entry.pinned
  }
}

function formatTarget(entry) {
  const context = entry.targetContext
  if (!context?.environment || !context?.app) return entry.target
  const version = context.displayVersion ? ` @ ${context.displayVersion}` : ''
  return `${context.environment.slug} / ${context.app.slug}${version}`
}
