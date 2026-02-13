/**
 * view-lookout.js
 *
 * Per-environment Lookout dashboard — shows containers for a specific
 * project/environment with sparkline history.
 */

module.exports = {
  friendlyName: 'View environment Lookout',

  description: 'Display the per-environment Lookout dashboard.',

  inputs: {
    slug: {
      type: 'string',
      required: true
    },
    envSlug: {
      type: 'string',
      defaultsTo: 'production'
    }
  },

  exits: {
    success: {
      responseType: 'inertia'
    },
    notFound: {
      responseType: 'redirect'
    }
  },

  fn: async function ({ slug, envSlug }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')
    if (!user) {
      throw { notFound: '/login' }
    }

    const project = await Project.findOne({ slug, team: user.team.id })
    if (!project) {
      throw { notFound: '/' }
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: envSlug
    }).decrypt()
    if (!environment) {
      throw { notFound: `/projects/${slug}` }
    }

    // Get app and services
    const app = await App.findOne({ environment: environment.id })
    const services = await Service.find({ environment: environment.id, status: 'running' })

    const containerNames = []
    if (app && app.containerName) containerNames.push(app.containerName)
    for (const s of services) {
      if (s.containerName) containerNames.push(s.containerName)
    }

    // Get latest metrics
    const latestMetrics = containerNames.length > 0
      ? await ContainerMetric.find({ containerName: containerNames })
        .sort('recordedAt DESC')
        .limit(containerNames.length * 2)
      : []

    const metricMap = {}
    for (const m of latestMetrics) {
      if (!metricMap[m.containerName]) {
        metricMap[m.containerName] = m
      }
    }

    // Get 1 hour of history for sparklines
    const oneHourAgo = Date.now() - (60 * 60 * 1000)
    const history = containerNames.length > 0
      ? await ContainerMetric.find({
        containerName: containerNames,
        recordedAt: { '>=': oneHourAgo }
      }).sort('recordedAt ASC')
      : []

    const historyMap = {}
    for (const m of history) {
      if (!historyMap[m.containerName]) historyMap[m.containerName] = []
      historyMap[m.containerName].push({
        cpu: m.cpuPercent,
        mem: m.memoryPercent,
        t: m.recordedAt
      })
    }

    // Build container list
    const containers = []

    if (app) {
      const metric = metricMap[app.containerName]
      containers.push({
        name: app.containerName,
        type: 'app',
        status: app.status,
        lastDeployedAt: app.lastDeployedAt,
        imageName: app.imageName,
        metric: metric ? {
          cpuPercent: metric.cpuPercent,
          memoryUsage: metric.memoryUsage,
          memoryLimit: metric.memoryLimit,
          memoryPercent: metric.memoryPercent,
          netIO: metric.netIO,
          blockIO: metric.blockIO,
          pids: metric.pids,
          recordedAt: metric.recordedAt
        } : null,
        history: historyMap[app.containerName] || []
      })
    }

    for (const service of services) {
      const metric = metricMap[service.containerName]
      containers.push({
        name: service.containerName,
        type: 'service',
        serviceType: service.type,
        serviceName: service.name,
        status: service.status,
        metric: metric ? {
          cpuPercent: metric.cpuPercent,
          memoryUsage: metric.memoryUsage,
          memoryLimit: metric.memoryLimit,
          memoryPercent: metric.memoryPercent,
          netIO: metric.netIO,
          blockIO: metric.blockIO,
          pids: metric.pids,
          recordedAt: metric.recordedAt
        } : null,
        history: historyMap[service.containerName] || []
      })
    }

    // Telemetry summary (last 1 hour)
    const telemetryCutoff = Date.now() - (60 * 60 * 1000)
    const [recentSpans, recentExceptions, slowQueries] = await Promise.all([
      TelemetrySpan.find({
        environment: environment.id,
        startedAt: { '>=': telemetryCutoff }
      }).sort('startedAt DESC').limit(500),
      TelemetryException.find({
        environment: environment.id,
        occurredAt: { '>=': telemetryCutoff }
      }).sort('occurredAt DESC').limit(200),
      TelemetryMetric.find({
        environment: environment.id,
        name: 'db.query',
        recordedAt: { '>=': telemetryCutoff }
      }).sort('value DESC').limit(50)
    ])

    // Compute telemetry stats
    const totalRequests = recentSpans.length
    const errorRequests = recentSpans.filter(s => s.statusCode >= 500).length
    const durations = recentSpans.map(s => s.duration).sort((a, b) => a - b)
    const p95Duration = durations.length > 0
      ? durations[Math.ceil(durations.length * 0.95) - 1]
      : 0
    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0

    // Group exceptions by type+message
    const exceptionGroups = {}
    for (const ex of recentExceptions) {
      const key = `${ex.exceptionType}::${ex.message}`
      if (!exceptionGroups[key]) {
        exceptionGroups[key] = {
          exceptionType: ex.exceptionType,
          message: ex.message,
          count: 0,
          lastSeen: ex.occurredAt,
          lastStackTrace: ex.stackTrace,
          lastUrl: ex.url,
          lastMethod: ex.method
        }
      }
      exceptionGroups[key].count++
    }

    const telemetry = {
      requests: {
        total: totalRequests,
        errors: errorRequests,
        errorRate: totalRequests > 0 ? ((errorRequests / totalRequests) * 100).toFixed(1) : '0',
        p95: Math.round(p95Duration),
        avg: Math.round(avgDuration),
        recent: recentSpans.slice(0, 20).map(s => ({
          name: s.name,
          method: s.method,
          url: s.url,
          statusCode: s.statusCode,
          duration: s.duration,
          startedAt: s.startedAt
        }))
      },
      exceptions: {
        total: recentExceptions.length,
        groups: Object.values(exceptionGroups).sort((a, b) => b.count - a.count).slice(0, 20)
      },
      queries: {
        slow: slowQueries.slice(0, 20).map(q => ({
          value: q.value,
          attributes: q.attributes,
          recordedAt: q.recordedAt
        })),
        total: slowQueries.length
      },
      hasTelemetry: recentSpans.length > 0 || recentExceptions.length > 0,
      telemetryToken: environment.telemetryToken
    }

    return {
      page: 'projects/lookout',
      props: {
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug
        },
        environment: {
          id: environment.id,
          name: environment.name,
          slug: environment.slug
        },
        containers,
        telemetry
      }
    }
  }
}
