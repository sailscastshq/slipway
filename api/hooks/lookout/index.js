/**
 * Lookout hook
 *
 * Collects Docker container resource metrics on a 30-second interval.
 * Stores snapshots in the ContainerMetric model and prunes data older than 24h.
 * Triggers resource alerts when CPU or memory exceeds 90%.
 */

module.exports = function defineLookoutHook(sails) {
  let pollInterval = null

  // Track alert cooldowns: containerName → last alert timestamp
  const alertCooldowns = new Map()
  const ALERT_COOLDOWN_MS = 15 * 60 * 1000 // 15 minutes

  return {
    initialize: async function () {
      sails.log.info('Initializing hook (`lookout`)')

      sails.after('hook:orm:loaded', () => {
        // Start polling after ORM is ready so we can query/create records
        pollInterval = setInterval(collectMetrics, 30000)
        // Immediate first collection
        collectMetrics()
      })
    },

    teardown: function (done) {
      if (pollInterval) {
        clearInterval(pollInterval)
      }
      done()
    }
  }

  async function collectMetrics() {
    try {
      const stats = await sails.helpers.docker.getContainerStats()

      if (!stats || stats.length === 0) {
        return
      }

      // Filter to slipway-managed containers only
      const slipwayStats = stats.filter(s => s.name && s.name.startsWith('slipway-'))

      if (slipwayStats.length === 0) {
        return
      }

      // Pre-fetch all running apps and services for matching
      const apps = await App.find({ status: 'running' }).populate('environment')
      const services = await Service.find({ status: 'running' }).populate('environment')

      const now = Date.now()
      const records = []

      for (const stat of slipwayStats) {
        // Try to match to an app first
        const matchedApp = apps.find(a => a.containerName === stat.name)
        if (matchedApp) {
          records.push({
            containerName: stat.name,
            containerType: 'app',
            cpuPercent: stat.cpuPercent,
            memoryUsage: stat.memUsage,
            memoryLimit: stat.memLimit,
            memoryPercent: stat.memPercent,
            netIO: stat.netIO,
            blockIO: stat.blockIO,
            pids: stat.pids,
            recordedAt: now,
            environment: matchedApp.environment.id,
            app: matchedApp.id
          })
          checkResourceAlert(stat, matchedApp.containerName, now)
          continue
        }

        // Try to match to a service
        const matchedService = services.find(s => s.containerName === stat.name)
        if (matchedService) {
          records.push({
            containerName: stat.name,
            containerType: 'service',
            cpuPercent: stat.cpuPercent,
            memoryUsage: stat.memUsage,
            memoryLimit: stat.memLimit,
            memoryPercent: stat.memPercent,
            netIO: stat.netIO,
            blockIO: stat.blockIO,
            pids: stat.pids,
            recordedAt: now,
            environment: matchedService.environment.id,
            service: matchedService.id
          })
          checkResourceAlert(stat, matchedService.containerName, now)
          continue
        }

        // Unknown slipway container — skip (orphaned container)
        sails.log.verbose('Lookout: Unmatched container:', stat.name)
      }

      // Bulk create metrics
      if (records.length > 0) {
        await ContainerMetric.createEach(records)
      }

      // Prune container metrics older than 24 hours
      const cutoff = now - (24 * 60 * 60 * 1000)
      await ContainerMetric.destroy({ recordedAt: { '<': cutoff } })

      // Prune telemetry data older than 7 days (runs alongside metric collection)
      const telemetryCutoff = now - (7 * 24 * 60 * 60 * 1000)
      await TelemetrySpan.destroy({ startedAt: { '<': telemetryCutoff } }).tolerate('error')
      await TelemetryException.destroy({ occurredAt: { '<': telemetryCutoff } }).tolerate('error')
      await TelemetryMetric.destroy({ recordedAt: { '<': telemetryCutoff } }).tolerate('error')
    } catch (err) {
      sails.log.warn('Lookout: Error collecting metrics:', err.message)
    }
  }

  async function checkResourceAlert(stat, containerName, now) {
    const cpuHigh = stat.cpuPercent > 90
    const memHigh = stat.memPercent > 90

    if (!cpuHigh && !memHigh) {
      return
    }

    // Check cooldown
    const lastAlert = alertCooldowns.get(containerName)
    if (lastAlert && (now - lastAlert) < ALERT_COOLDOWN_MS) {
      return
    }

    alertCooldowns.set(containerName, now)

    try {
      await sails.helpers.notification.sendResourceAlert({
        containerName,
        cpuPercent: stat.cpuPercent,
        memoryPercent: stat.memPercent,
        cpuHigh,
        memHigh
      })
    } catch (alertErr) {
      sails.log.verbose('Lookout: Failed to send resource alert:', alertErr.message)
    }
  }
}
