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
    })
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
        containers
      }
    }
  }
}
