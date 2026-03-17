/**
 * get-overview.js
 *
 * Returns all running containers for the user's team with their latest metrics.
 * Used by the global /lookout dashboard.
 */

module.exports = {
  friendlyName: 'Get Lookout overview',

  description:
    'Get all running containers with latest metrics for the global dashboard.',

  exits: {
    success: {
      statusCode: 200
    }
  },

  fn: async function () {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )
    if (!user) return { containers: [], hostDisk: null }

    const hostDisk = await sails.helpers.lookout.getDiskSpace()

    // Get all projects for the user's team
    const projects = await Project.find({ team: user.team.id })
    const projectIds = projects.map((p) => p.id)
    if (projectIds.length === 0) return { containers: [], hostDisk }

    // Get all environments for these projects
    const environments = await Environment.find({ project: projectIds })
    const environmentIds = environments.map((e) => e.id)
    if (environmentIds.length === 0) return { containers: [], hostDisk }

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

    if (containerNames.length === 0) return { containers: [], hostDisk }

    // Get latest metric for each container (most recent recordedAt)
    const latestMetrics = await ContainerMetric.find({
      containerName: containerNames
    })
      .sort('recordedAt DESC')
      .limit(containerNames.length * 2)

    // Deduplicate to one metric per container
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

    return { containers, hostDisk }
  }
}
