/**
 * Lookout hook
 *
 * Collects Docker container resource metrics on a 30-second interval.
 * Stores snapshots in the ContainerMetric model and prunes data older than 24h.
 * Triggers resource alerts when CPU or memory exceeds 90% for 3 consecutive samples (~90s).
 *
 * Also:
 * - Lifecycle reconciliation: converges app/service status with Docker state
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
        // Main 30-second interval: lifecycle reconciliation + metrics.
        pollInterval = setInterval(runLookoutCycle, 30000)
        runLookoutCycle()

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

  async function runLookoutCycle() {
    await reconcileLifecycleStatuses()
    await collectMetrics()
  }

  async function reconcileLifecycleStatuses() {
    try {
      const transitions =
        await sails.helpers.lookout.reconcileContainerStatuses()

      for (const transition of transitions) {
        const cooldownKey = `down:${transition.containerName}`

        if (transition.to === 'running') {
          alertCooldowns.delete(cooldownKey)
          sails.log.info(
            `Lookout: Container recovered: ${transition.containerName} (${transition.resourceType})`
          )
          continue
        }

        sails.log.warn(
          `Lookout: Container down: ${transition.containerName} (${transition.resourceType})`
        )

        const now = Date.now()
        const lastAlert = alertCooldowns.get(cooldownKey)
        if (lastAlert && now - lastAlert < ALERT_COOLDOWN_MS) continue
        alertCooldowns.set(cooldownKey, now)

        try {
          await sails.helpers.notification.sendContainerDownAlert.with({
            containerName: transition.containerName,
            resourceType: transition.resourceType
          })
        } catch (alertErr) {
          sails.log.verbose(
            'Lookout: Failed to send container down alert:',
            alertErr.message
          )
        }
      }
    } catch (err) {
      sails.log.warn(
        'Lookout: Could not reconcile container lifecycle state:',
        err.message
      )
    }
  }

  async function collectMetrics() {
    try {
      const stats = await sails.helpers.docker.getContainerStats()

      // Pre-fetch currently running apps and services for metric matching.
      // Lifecycle truth is reconciled separately from this stats sample.
      const apps = await App.find({ status: 'running' }).populate('environment')
      const services = await Service.find({ status: 'running' }).populate(
        'environment'
      )
      const now = Date.now()

      if (!stats || stats.length === 0) {
        return
      }

      // Filter to slipway-managed containers only
      const slipwayStats = stats.filter(
        (s) => s.name && s.name.startsWith('slipway-')
      )

      if (slipwayStats.length === 0) {
        return
      }

      const records = []

      for (const stat of slipwayStats) {
        // Try to match to an app first
        const matchedApp = apps.find((a) => a.containerName === stat.name)
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
          await checkResourceAlert(stat, matchedApp.containerName, now)
          continue
        }

        // Try to match to a service
        const matchedService = services.find(
          (s) => s.containerName === stat.name
        )
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
          await checkResourceAlert(stat, matchedService.containerName, now)
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
      const cutoff = now - 24 * 60 * 60 * 1000
      await ContainerMetric.destroy({ recordedAt: { '<': cutoff } })

      // Prune telemetry data older than 7 days (runs alongside metric collection)
      const telemetryCutoff = now - 7 * 24 * 60 * 60 * 1000
      await TelemetrySpan.destroy({
        startedAt: { '<': telemetryCutoff }
      }).tolerate('error')
      await TelemetryException.destroy({
        occurredAt: { '<': telemetryCutoff }
      }).tolerate('error')
      await TelemetryMetric.destroy({
        recordedAt: { '<': telemetryCutoff }
      }).tolerate('error')

      // Check host disk space (every cycle, but alert on cooldown)
      await checkDiskSpace(now)
    } catch (err) {
      sails.log.warn('Lookout: Error collecting metrics:', err.message)
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

        const lastCollected =
          lastLogCollection.get(app.containerName) || now - 5 * 60 * 1000
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
      const logCutoff = now - 7 * 24 * 60 * 60 * 1000
      await AppLog.destroy({ endedAt: { '<': logCutoff } })
    } catch (err) {
      sails.log.verbose('Lookout: Error collecting logs:', err.message)
    }
  }

  async function checkDiskSpace(now) {
    try {
      const cooldownKey = 'disk:space'
      const lastAlert = alertCooldowns.get(cooldownKey)
      if (lastAlert && now - lastAlert < ALERT_COOLDOWN_MS) return

      const diskInfo = await sails.helpers.lookout.getDiskSpace()
      if (!diskInfo) return

      if (diskInfo.usedPercent >= 90) {
        alertCooldowns.set(cooldownKey, now)
        sails.log.warn(
          `Lookout: Disk space critical — ${diskInfo.usedPercent}% used, ${diskInfo.available} available`
        )
        await sails.helpers.notification.sendDiskSpaceAlert
          .with({
            usedPercent: diskInfo.usedPercent,
            availableGb: diskInfo.available
          })
          .tolerate('error')
      }
    } catch (err) {
      sails.log.verbose('Lookout: Disk space check error:', err.message)
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
    if (lastAlert && now - lastAlert < ALERT_COOLDOWN_MS) {
      return
    }

    // Require sustained high usage: check last 3 consecutive samples (~90s)
    // to filter out transient spikes from GC, request bursts, etc.
    const SUSTAINED_SAMPLES = 3
    const recentMetrics = await ContainerMetric.find({
      where: { containerName },
      sort: 'recordedAt DESC',
      limit: SUSTAINED_SAMPLES
    })

    // Not enough history yet — skip alerting until we have enough samples
    if (recentMetrics.length < SUSTAINED_SAMPLES) {
      return
    }

    const sustainedCpuHigh =
      cpuHigh && recentMetrics.every((m) => m.cpuPercent > 90)
    const sustainedMemHigh =
      memHigh && recentMetrics.every((m) => m.memoryPercent > 90)

    if (!sustainedCpuHigh && !sustainedMemHigh) {
      return
    }

    alertCooldowns.set(containerName, now)

    try {
      await sails.helpers.notification.sendResourceAlert.with({
        containerName,
        cpuPercent: stat.cpuPercent,
        memoryPercent: stat.memPercent,
        cpuHigh: sustainedCpuHigh,
        memHigh: sustainedMemHigh
      })
    } catch (alertErr) {
      sails.log.verbose(
        'Lookout: Failed to send resource alert:',
        alertErr.message
      )
    }
  }
}
