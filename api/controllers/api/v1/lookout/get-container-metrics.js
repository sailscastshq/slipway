/**
 * get-container-metrics.js
 *
 * Returns the full 24-hour metric history for a single container.
 * Used for detailed charts when drilling into a specific container.
 */

module.exports = {
  friendlyName: 'Get container metrics',

  description: 'Get 24-hour metric history for a specific container.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
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

  fn: async function ({ containerName }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )
    if (!user) throw 'notFound'

    // Verify user has access to this container (belongs to their team)
    const app = await App.findOne({ containerName })
    const service = !app ? await Service.findOne({ containerName }) : null

    if (!app && !service) throw 'notFound'

    const entityEnvironmentId = app ? app.environment : service.environment
    const environment = await Environment.findOne({ id: entityEnvironmentId })
    if (!environment) throw 'notFound'

    const project = await Project.findOne({
      id: environment.project,
      team: user.team.id
    })
    if (!project) throw 'notFound'

    // Get full 24h history
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000
    const metrics = await ContainerMetric.find({
      containerName,
      recordedAt: { '>=': twentyFourHoursAgo }
    }).sort('recordedAt ASC')

    const mapped = metrics.map((m) => ({
      cpuPercent: m.cpuPercent,
      memoryUsage: m.memoryUsage,
      memoryLimit: m.memoryLimit,
      memoryPercent: m.memoryPercent,
      netIO: m.netIO,
      blockIO: m.blockIO,
      pids: m.pids,
      recordedAt: m.recordedAt
    }))

    return {
      containerName,
      containerType: app ? 'app' : 'service',
      metrics: downsample(mapped, 200)
    }
  }
}

/**
 * Downsample an array to at most maxPoints entries.
 * Keeps first and last, evenly samples the rest.
 */
function downsample(data, maxPoints) {
  if (data.length <= maxPoints) return data
  const result = [data[0]]
  const step = (data.length - 1) / (maxPoints - 1)
  for (let i = 1; i < maxPoints - 1; i++) {
    result.push(data[Math.round(i * step)])
  }
  result.push(data[data.length - 1])
  return result
}
