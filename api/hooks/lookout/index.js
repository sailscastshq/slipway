/**
 * Lookout hook
 *
 * Collects Docker container resource metrics on a 30-second interval.
 * Stores snapshots in the ContainerMetric model and prunes data older than 24h.
 * Triggers resource alerts when CPU or memory exceeds 90%.
 *
 * Also:
 * - Health checks: detects containers that should be running but aren't
 * - Log persistence: collects container logs every 5 minutes, prunes after 7 days
 */

module.exports = function defineLookoutHook(sails) {
  let pollInterval = null
  let logInterval = null

  // Track alert cooldowns: containerName → last alert timestamp
  const alertCooldowns = new Map()
  const ALERT_COOLDOWN_MS = 15 * 60 * 1000 // 15 minutes

  // Track last log collection timestamp per container
  const lastLogCollection = new Map()

  return {
    initialize: async function () {
      sails.log.info('Initializing hook (`lookout`)')

      sails.after('hook:orm:loaded', () => {
        // Main 30-second interval: metrics + health checks + backup schedule check
        pollInterval = setInterval(collectMetrics, 30000)
        collectMetrics()

        // Separate 5-minute interval for log collection
        logInterval = setInterval(collectLogs, 5 * 60 * 1000)
      })
    },

    teardown: function (done) {
      if (pollInterval) clearInterval(pollInterval)
      if (logInterval) clearInterval(logInterval)
      done()
    }
  }

  async function collectMetrics() {
    try {
      const stats = await sails.helpers.docker.getContainerStats()

      // Pre-fetch all running apps and services for matching
      const apps = await App.find({ status: 'running' }).populate('environment')
      const services = await Service.find({ status: 'running' }).populate('environment')
      const now = Date.now()

      // Health check: detect containers that are in DB as 'running' but missing from docker stats
      const runningContainerNames = new Set((stats || []).map(s => s.name))
      await checkHealth(apps, services, runningContainerNames, now)

      if (!stats || stats.length === 0) {
        return
      }

      // Filter to slipway-managed containers only
      const slipwayStats = stats.filter(s => s.name && s.name.startsWith('slipway-'))

      if (slipwayStats.length === 0) {
        return
      }

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

        // Publish new data points to SSE channels (one message per environment)
        const byEnv = {}
        for (const r of records) {
          if (!byEnv[r.environment]) byEnv[r.environment] = []
          byEnv[r.environment].push({
            containerName: r.containerName,
            containerType: r.containerType,
            cpuPercent: r.cpuPercent,
            memoryUsage: r.memoryUsage,
            memoryLimit: r.memoryLimit,
            memoryPercent: r.memoryPercent,
            netIO: r.netIO,
            blockIO: r.blockIO,
            pids: r.pids,
            recordedAt: r.recordedAt
          })
        }
        for (const envId of Object.keys(byEnv)) {
          sails.sse.publish(`lookout:env:${envId}`, { metrics: byEnv[envId] })
        }
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

  /**
   * Health check: compare DB 'running' state against actual docker stats.
   * Any app/service marked running but not in docker stats is down.
   */
  async function checkHealth(apps, services, runningContainerNames, now) {
    try {
      for (const app of apps) {
        if (!app.containerName || runningContainerNames.has(app.containerName)) continue

        // Container is not in docker stats — it's down
        sails.log.warn(`Lookout: Container down: ${app.containerName} (app)`)
        await App.updateOne({ id: app.id }).set({ status: 'stopped' })

        // Check cooldown before alerting
        const cooldownKey = `down:${app.containerName}`
        const lastAlert = alertCooldowns.get(cooldownKey)
        if (lastAlert && (now - lastAlert) < ALERT_COOLDOWN_MS) continue
        alertCooldowns.set(cooldownKey, now)

        try {
          await sails.helpers.notification.sendContainerDownAlert.with({
            containerName: app.containerName,
            resourceType: 'app'
          })
        } catch (alertErr) {
          sails.log.verbose('Lookout: Failed to send container down alert:', alertErr.message)
        }
      }

      for (const service of services) {
        if (!service.containerName || runningContainerNames.has(service.containerName)) continue

        sails.log.warn(`Lookout: Container down: ${service.containerName} (service)`)
        await Service.updateOne({ id: service.id }).set({ status: 'stopped' })

        const cooldownKey = `down:${service.containerName}`
        const lastAlert = alertCooldowns.get(cooldownKey)
        if (lastAlert && (now - lastAlert) < ALERT_COOLDOWN_MS) continue
        alertCooldowns.set(cooldownKey, now)

        try {
          await sails.helpers.notification.sendContainerDownAlert.with({
            containerName: service.containerName,
            resourceType: 'service'
          })
        } catch (alertErr) {
          sails.log.verbose('Lookout: Failed to send container down alert:', alertErr.message)
        }
      }
    } catch (err) {
      sails.log.verbose('Lookout: Health check error:', err.message)
    }
  }

  /**
   * Collect container logs for all running apps (every 5 minutes).
   * Also prunes logs older than 7 days.
   */
  async function collectLogs() {
    try {
      const apps = await App.find({ status: 'running' }).populate('environment')
      const now = Date.now()

      for (const app of apps) {
        if (!app.containerName) continue

        const lastCollected = lastLogCollection.get(app.containerName) || (now - 5 * 60 * 1000)
        const sinceSeconds = Math.floor((now - lastCollected) / 1000)

        const result = await sails.helpers.docker.collectLogs.with({
          containerName: app.containerName,
          since: `${sinceSeconds}s`
        })

        if (result.lineCount > 0) {
          await AppLog.create({
            containerName: app.containerName,
            logs: result.logs,
            startedAt: lastCollected,
            endedAt: now,
            lineCount: result.lineCount,
            app: app.id,
            environment: app.environment.id
          })
        }

        lastLogCollection.set(app.containerName, now)
      }

      // Prune app logs older than 7 days
      const logCutoff = now - (7 * 24 * 60 * 60 * 1000)
      await AppLog.destroy({ endedAt: { '<': logCutoff } })
    } catch (err) {
      sails.log.verbose('Lookout: Error collecting logs:', err.message)
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
      await sails.helpers.notification.sendResourceAlert.with({
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
