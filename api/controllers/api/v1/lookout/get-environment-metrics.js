/**
 * get-environment-metrics.js
 *
 * Returns metrics for containers in a specific environment.
 * Includes latest snapshot + 1 hour of history for sparklines.
 */

module.exports = {
  friendlyName: 'Get environment metrics',

  description: 'Get metrics for all containers in a specific environment.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    }
  },

  fn: async function ({ projectSlug, environmentSlug }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')
    if (!user) throw 'notFound'

    const project = await Project.findOne({ slug: projectSlug, team: user.team.id })
    if (!project) throw 'notFound'

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })
    if (!environment) throw 'notFound'

    // Get app and services for this environment
    const app = await App.findOne({ environment: environment.id, isDefault: true }) || await App.findOne({ environment: environment.id })
    const services = await Service.find({ environment: environment.id, status: 'running' })

    const containerNames = []
    if (app && app.containerName) containerNames.push(app.containerName)
    for (const s of services) {
      if (s.containerName) containerNames.push(s.containerName)
    }

    if (containerNames.length === 0) {
      return { containers: [], history: {} }
    }

    // Get latest metrics
    const latestMetrics = await ContainerMetric.find({
      containerName: containerNames
    }).sort('recordedAt DESC').limit(containerNames.length * 2)

    const metricMap = {}
    for (const m of latestMetrics) {
      if (!metricMap[m.containerName]) {
        metricMap[m.containerName] = m
      }
    }

    // Get 1 hour of history for sparklines
    const oneHourAgo = Date.now() - (60 * 60 * 1000)
    const history = await ContainerMetric.find({
      containerName: containerNames,
      recordedAt: { '>=': oneHourAgo }
    }).sort('recordedAt ASC')

    // Group history by container
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

    return { containers }
  }
}
