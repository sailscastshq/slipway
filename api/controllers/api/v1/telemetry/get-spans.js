/**
 * GET /api/v1/projects/:projectSlug/telemetry/spans
 * GET /api/v1/projects/:projectSlug/environments/:environmentSlug/telemetry/spans
 *
 * Returns recent request spans for an environment with pagination.
 */

module.exports = {
  friendlyName: 'Get telemetry spans',

  description: 'Retrieve request spans for an environment.',

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
    slow: {
      type: 'boolean',
      description: 'If true, only return slow requests (>1000ms)'
    },
    status: {
      type: 'string',
      description: 'Filter by status code range: "2xx", "4xx", "5xx"'
    }
  },

  fn: async function ({ projectSlug, environmentSlug, page, limit, slow, status }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')
    if (!user) return this.res.status(401).json({ error: 'Unauthorized' })

    const project = await Project.findOne({ slug: projectSlug, team: user.team.id })
    if (!project) return this.res.status(404).json({ error: 'Project not found' })

    // Get environment
    const envWhere = { project: project.id }
    if (environmentSlug) {
      envWhere.slug = environmentSlug
    }
    const environment = await Environment.findOne(envWhere)
    if (!environment) return this.res.status(404).json({ error: 'Environment not found' })

    // Build query
    const where = { environment: environment.id }
    if (slow) {
      where.duration = { '>=': 1000 }
    }
    if (status) {
      const base = parseInt(status)
      if (base >= 100 && base < 600) {
        where.statusCode = { '>=': base, '<': base + 100 }
      }
    }

    const safeLimit = Math.min(Math.max(limit, 1), 100)
    const skip = (Math.max(page, 1) - 1) * safeLimit

    const [spans, total] = await Promise.all([
      TelemetrySpan.find({ where, sort: 'startedAt DESC', limit: safeLimit, skip }),
      TelemetrySpan.count(where)
    ])

    return {
      spans,
      pagination: {
        page: Math.max(page, 1),
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit)
      }
    }
  }
}
