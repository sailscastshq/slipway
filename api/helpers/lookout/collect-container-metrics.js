module.exports = {
  friendlyName: 'Collect container metrics',

  description:
    'Collect and persist one Lookout sample while recording durable collector health.',

  inputs: {},

  fn: async function () {
    const attemptedAt = Date.now()

    try {
      const stats = (await sails.helpers.docker.getContainerStats()) || []
      const slipwayStats = stats.filter(
        (stat) => stat.name && stat.name.startsWith('slipway-')
      )
      const records = []
      const alertSamples = []

      if (slipwayStats.length > 0) {
        const [apps, services] = await Promise.all([
          App.find({ status: 'running' }).populate('environment'),
          Service.find({ status: 'running' }).populate('environment')
        ])

        for (const stat of slipwayStats) {
          const matchedApp = apps.find((app) => app.containerName === stat.name)
          const matchedService = matchedApp
            ? null
            : services.find((service) => service.containerName === stat.name)
          const owner = matchedApp || matchedService

          if (!owner) {
            sails.log.verbose('Lookout: Unmatched container:', stat.name)
            continue
          }

          records.push({
            containerName: stat.name,
            containerType: matchedApp ? 'app' : 'service',
            cpuPercent: stat.cpuPercent,
            memoryUsage: stat.memUsage,
            memoryLimit: stat.memLimit,
            memoryPercent: stat.memPercent,
            netIO: stat.netIO,
            blockIO: stat.blockIO,
            pids: stat.pids,
            recordedAt: attemptedAt,
            environment: owner.environment.id,
            app: matchedApp ? matchedApp.id : null,
            service: matchedService ? matchedService.id : null
          })
          alertSamples.push({
            stat,
            containerName: owner.containerName
          })
        }
      }

      if (records.length > 0) {
        await ContainerMetric.createEach(records)
        publishMetrics(records)
      }

      const rowCount = await ContainerMetric.count()
      const completedAt = Date.now()
      const details = {
        dockerRows: stats.length,
        managedRows: slipwayStats.length,
        recordedRows: records.length
      }

      await sails.helpers.lookout.recordObservabilityHealth.with({
        jobName: 'collector',
        succeeded: true,
        attemptedAt,
        completedAt,
        rowCount,
        details
      })

      return { records, alertSamples, rowCount, details }
    } catch (error) {
      const completedAt = Date.now()
      try {
        await sails.helpers.lookout.recordObservabilityHealth.with({
          jobName: 'collector',
          succeeded: false,
          attemptedAt,
          completedAt,
          details: {},
          error: error.message || String(error)
        })
      } catch (healthError) {
        sails.log.warn(
          `Lookout: Could not persist collector failure: ${healthError.message}`
        )
      }
      throw error
    }
  }
}

function publishMetrics(records) {
  if (!sails.sse?.publish) return

  const byEnvironment = {}
  for (const record of records) {
    if (!byEnvironment[record.environment]) {
      byEnvironment[record.environment] = []
    }
    byEnvironment[record.environment].push({
      containerName: record.containerName,
      containerType: record.containerType,
      cpuPercent: record.cpuPercent,
      memoryUsage: record.memoryUsage,
      memoryLimit: record.memoryLimit,
      memoryPercent: record.memoryPercent,
      netIO: record.netIO,
      blockIO: record.blockIO,
      pids: record.pids,
      recordedAt: record.recordedAt
    })
  }

  for (const environmentId of Object.keys(byEnvironment)) {
    sails.sse.publish(`lookout:env:${environmentId}`, {
      metrics: byEnvironment[environmentId]
    })
  }
}
