/**
 * GET /api/v1/projects/:projectSlug/telemetry/exceptions
 * GET /api/v1/projects/:projectSlug/environments/:environmentSlug/telemetry/exceptions
 *
 * Returns recent exceptions grouped by type+message with occurrence counts.
 */

module.exports = {
  friendlyName: 'Get telemetry exceptions',

  description: 'Retrieve exceptions for an environment, grouped by type.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string'
    },
    page: {
      type: 'number',
      defaultsTo: 1
    },
    limit: {
      type: 'number',
      defaultsTo: 50
    },
    grouped: {
      type: 'boolean',
      defaultsTo: true,
      description: 'If true, group exceptions by type+message'
    }
  },

  fn: async function ({ projectSlug, environmentSlug, page, limit, grouped }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )
    if (!user) return this.res.status(401).json({ error: 'Unauthorized' })

    const project = await Project.findOne({
      slug: projectSlug,
      team: user.team.id
    })
    if (!project)
      return this.res.status(404).json({ error: 'Project not found' })

    const envWhere = { project: project.id }
    if (environmentSlug) {
      envWhere.slug = environmentSlug
    }
    const environment = await Environment.findOne(envWhere)
    if (!environment)
      return this.res.status(404).json({ error: 'Environment not found' })

    const where = { environment: environment.id }
    const safeLimit = Math.min(Math.max(limit, 1), 100)
    const skip = (Math.max(page, 1) - 1) * safeLimit

    if (!grouped) {
      const [exceptions, total] = await Promise.all([
        TelemetryException.find({
          where,
          sort: 'occurredAt DESC',
          limit: safeLimit,
          skip
        }),
        TelemetryException.count(where)
      ])
      return {
        exceptions,
        pagination: {
          page: Math.max(page, 1),
          limit: safeLimit,
          total,
          pages: Math.ceil(total / safeLimit)
        }
      }
    }

    // Grouped mode: fetch all recent exceptions, group in JS
    // (Waterline doesn't support GROUP BY natively across all adapters)
    const allExceptions = await TelemetryException.find({
      where,
      sort: 'occurredAt DESC',
      limit: 5000
    })

    const groups = {}
    for (const ex of allExceptions) {
      const key = `${ex.exceptionType}::${ex.message}`
      if (!groups[key]) {
        groups[key] = {
          exceptionType: ex.exceptionType,
          message: ex.message,
          handled: ex.handled,
          count: 0,
          firstSeen: ex.occurredAt,
          lastSeen: ex.occurredAt,
          lastStackTrace: ex.stackTrace,
          lastUrl: ex.url,
          lastMethod: ex.method
        }
      }
      groups[key].count++
      if (ex.occurredAt < groups[key].firstSeen)
        groups[key].firstSeen = ex.occurredAt
      if (ex.occurredAt > groups[key].lastSeen) {
        groups[key].lastSeen = ex.occurredAt
        groups[key].lastStackTrace = ex.stackTrace
        groups[key].lastUrl = ex.url
        groups[key].lastMethod = ex.method
      }
    }

    const sorted = Object.values(groups).sort((a, b) => b.lastSeen - a.lastSeen)
    const total = sorted.length
    const paged = sorted.slice(skip, skip + safeLimit)

    return {
      exceptions: paged,
      pagination: {
        page: Math.max(page, 1),
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit)
      }
    }
  }
}
