/**
 * view-lookout.js
 *
 * Global Lookout dashboard — shows all running containers across all projects
 * with their latest resource metrics.
 */

module.exports = {
  friendlyName: 'View Lookout',

  description: 'Display the global Lookout infrastructure dashboard.',

  exits: {
    success: {
      responseType: 'inertia'
    },
    notFound: {
      responseType: 'redirect'
    }
  },

  fn: async function () {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )
    if (!user) {
      throw { notFound: '/login' }
    }

    const hostDisk = await sails.helpers.lookout.getDiskSpace()
    const observabilityHealth =
      await sails.helpers.lookout.getObservabilityHealth()

    // Get all projects for the user's team
    const projects = await Project.find({ team: user.team.id })
    const projectIds = projects.map((p) => p.id)

    if (projectIds.length === 0) {
      return {
        page: 'lookout/index',
        props: {
          containers: [],
          telemetrySummary: {},
          hostDisk,
          observabilityHealth
        }
      }
    }

    // Get all environments for these projects
    const environments = await Environment.find({ project: projectIds })
    const environmentIds = environments.map((e) => e.id)

    if (environmentIds.length === 0) {
      return {
        page: 'lookout/index',
        props: {
          containers: [],
          telemetrySummary: {},
          hostDisk,
          observabilityHealth
        }
      }
    }

    // Get all running apps and services
    const apps = await App.find({
      environment: environmentIds,
      status: 'running'
    })
    const services = await Service.find({
      environment: environmentIds,
      status: 'running'
    })

    // Gather all container names
    const containerNames = [
      ...apps.map((a) => a.containerName),
      ...services.map((s) => s.containerName)
    ].filter(Boolean)

    // Get latest metric for each container
    const latestMetrics =
      containerNames.length > 0
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

    // Build container list
    const containers = []

    for (const app of apps) {
      const env = environments.find((e) => e.id === app.environment)
      const proj = projects.find((p) => p.id === env?.project)
      const metric = metricMap[app.containerName]

      containers.push({
        name: app.containerName,
        type: 'app',
        status: app.status,
        project: proj
          ? { id: proj.id, name: proj.name, slug: proj.slug }
          : null,
        environment: env
          ? { id: env.id, name: env.name, slug: env.slug }
          : null,
        lastDeployedAt: app.lastDeployedAt,
        metric: metric
          ? {
              cpuPercent: metric.cpuPercent,
              memoryUsage: metric.memoryUsage,
              memoryLimit: metric.memoryLimit,
              memoryPercent: metric.memoryPercent,
              netIO: metric.netIO,
              pids: metric.pids,
              recordedAt: metric.recordedAt
            }
          : null
      })
    }

    for (const service of services) {
      const env = environments.find((e) => e.id === service.environment)
      const proj = projects.find((p) => p.id === env?.project)
      const metric = metricMap[service.containerName]

      containers.push({
        name: service.containerName,
        type: 'service',
        serviceType: service.type,
        serviceName: service.name,
        status: service.status,
        project: proj
          ? { id: proj.id, name: proj.name, slug: proj.slug }
          : null,
        environment: env
          ? { id: env.id, name: env.name, slug: env.slug }
          : null,
        metric: metric
          ? {
              cpuPercent: metric.cpuPercent,
              memoryUsage: metric.memoryUsage,
              memoryLimit: metric.memoryLimit,
              memoryPercent: metric.memoryPercent,
              netIO: metric.netIO,
              pids: metric.pids,
              recordedAt: metric.recordedAt
            }
          : null
      })
    }

    // Global telemetry summary per environment (last 1 hour)
    const telemetryCutoff = Date.now() - 60 * 60 * 1000
    const telemetrySummary = {}

    for (const env of environments) {
      const [spanCount, exceptionCount] = await Promise.all([
        TelemetrySpan.count({
          environment: env.id,
          startedAt: { '>=': telemetryCutoff }
        }),
        TelemetryException.count({
          environment: env.id,
          occurredAt: { '>=': telemetryCutoff }
        })
      ])
      if (spanCount > 0 || exceptionCount > 0) {
        telemetrySummary[env.id] = {
          requests: spanCount,
          exceptions: exceptionCount
        }
      }
    }

    return {
      page: 'lookout/index',
      props: {
        containers,
        telemetrySummary,
        hostDisk,
        observabilityHealth
      }
    }
  }
}
