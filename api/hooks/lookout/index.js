/**
 * Lookout hook
 *
 * Collects Docker container resource metrics on a 30-second interval.
 * Stores snapshots in the ContainerMetric model.
 * Triggers resource alerts when CPU or memory exceeds 90% for 3 consecutive samples (~90s).
 *
 * Also:
 * - Lifecycle reconciliation: converges app/service status with Docker state
 * - Log persistence: collects container logs every 5 minutes, prunes after 7 days
 */

module.exports = function defineLookoutHook(sails) {
  let pollInterval = null
  let logInterval = null
  let cycleRunning = false

  // Track alert cooldowns: containerName → last alert timestamp
  const alertCooldowns = new Map()
  const ALERT_COOLDOWN_MS = 15 * 60 * 1000 // 15 minutes

  // Track last log collection timestamp per container
  const lastLogCollection = new Map()

  return {
    initialize: async function () {
      sails.log.info('Initializing hook (`lookout`)')

      sails.after('hook:orm:loaded', async () => {
        try {
          await sails.helpers.lookout.ensureObservabilitySchema()
        } catch (error) {
          sails.log.warn(
            `Lookout: Could not prepare observability storage: ${error.message}`
          )
        }

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
    if (cycleRunning) return
    cycleRunning = true
    try {
      await reconcileLifecycleStatuses()
      await collectMetrics()
    } finally {
      cycleRunning = false
    }
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
      const result = await sails.helpers.lookout.collectContainerMetrics()
      for (const sample of result.alertSamples) {
        await checkResourceAlert(sample.stat, sample.containerName, Date.now())
      }
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
