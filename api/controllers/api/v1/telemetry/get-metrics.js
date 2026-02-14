/**
 * GET /api/v1/projects/:projectSlug/telemetry/metrics
 * GET /api/v1/projects/:projectSlug/environments/:environmentSlug/telemetry/metrics
 *
 * Returns telemetry metrics with aggregation (slow queries, etc.).
 */

module.exports = {
  friendlyName: 'Get telemetry metrics',

  description: 'Retrieve application metrics for an environment.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string'
    },
    name: {
      type: 'string',
      description: 'Filter by metric name, e.g. "db.query"'
    },
    period: {
      type: 'string',
      defaultsTo: '1h',
      description: 'Time period: "1h", "6h", "24h", "7d"'
    }
  },

  fn: async function ({ projectSlug, environmentSlug, name, period }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')
    if (!user) return this.res.status(401).json({ error: 'Unauthorized' })

    const project = await Project.findOne({ slug: projectSlug, team: user.team.id })
    if (!project) return this.res.status(404).json({ error: 'Project not found' })

    const envWhere = { project: project.id }
    if (environmentSlug) {
      envWhere.slug = environmentSlug
    }
    const environment = await Environment.findOne(envWhere)
    if (!environment) return this.res.status(404).json({ error: 'Environment not found' })

    // Calculate cutoff based on period
    const periodMs = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000
    }
    const cutoff = Date.now() - (periodMs[period] || periodMs['1h'])

    const where = {
      environment: environment.id,
      recordedAt: { '>=': cutoff }
    }
    if (name) {
      where.name = name
    }

    const metrics = await TelemetryMetric.find({
      where,
      sort: 'recordedAt DESC',
      limit: 2000
    })

    // Aggregate by metric name
    const aggregated = {}
    for (const m of metrics) {
      if (!aggregated[m.name]) {
        aggregated[m.name] = {
          name: m.name,
          unit: m.unit,
          count: 0,
          sum: 0,
          min: Infinity,
          max: -Infinity,
          values: []
        }
      }
      const agg = aggregated[m.name]
      agg.count++
      agg.sum += m.value
      if (m.value < agg.min) agg.min = m.value
      if (m.value > agg.max) agg.max = m.value
      agg.values.push({ value: m.value, recordedAt: m.recordedAt, attributes: m.attributes })
    }

    // Calculate averages and p95
    for (const agg of Object.values(aggregated)) {
      agg.avg = agg.count > 0 ? agg.sum / agg.count : 0
      if (agg.min === Infinity) agg.min = 0
      if (agg.max === -Infinity) agg.max = 0

      // p95
      const sorted = agg.values.map(v => v.value).sort((a, b) => a - b)
      const p95Index = Math.ceil(sorted.length * 0.95) - 1
      agg.p95 = sorted[Math.max(p95Index, 0)] || 0

      // Keep only recent values for charts (limit to 200)
      agg.values = agg.values.slice(0, 200)
    }

    return {
      metrics: Object.values(aggregated).sort((a, b) => b.count - a.count),
      period,
      cutoff
    }
  }
}
