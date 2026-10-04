/**
 * Lookout hook
 *
 * Collects Docker container resource metrics on a 30-second interval.
 * Stores snapshots in the ContainerMetric model.
 * Triggers one alert per sustained high-resource incident, after 3 samples.
 *
 * Also:
 * - Lifecycle reconciliation: converges app/service status with Docker state
 * - Log persistence: collects container logs every 5 minutes, prunes after 7 days
 */

module.exports = function defineLookoutHook(sails) {
  const {
    advanceResourceAlertState
  } = require('../../lib/resource-alert-state')
  let pollInterval = null
  let logInterval = null
  let cycleRunning = false
  let deliveryInterval = null
  let deliveryRunning = false

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
        deliveryInterval = setInterval(deliverResourceAlerts, 30000)
        deliverResourceAlerts()

        // Separate 5-minute interval for log collection
        logInterval = setInterval(collectLogs, 5 * 60 * 1000)
      })
    },

    teardown: function (done) {
      if (pollInterval) clearInterval(pollInterval)
      if (logInterval) clearInterval(logInterval)
      if (deliveryInterval) clearInterval(deliveryInterval)
      done()
    }
  }

  async function deliverResourceAlerts() {
    if (deliveryRunning) return
    deliveryRunning = true
    try {
      await sails.helpers.lookout.deliverResourceAlerts()
    } catch {
      sails.log.warn(
        'Lookout: Resource delivery queue unavailable; retry on next cycle'
      )
    } finally {
      deliveryRunning = false
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
        await checkResourceAlert(sample, sample.recordedAt)
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

  async function checkResourceAlert(
    { stat, containerName, environmentId },
    now
  ) {
    const previous = await ResourceAlertState.findOne({ containerName })
    const { state, cpuHigh, memHigh, skipped } = advanceResourceAlertState(
      previous,
      stat,
      now
    )
    if (skipped) return
    const queue = { cpu: cpuHigh, memory: memHigh }
    // An upgraded installation may already have an active incident from the
    // old sender. Seed it only from a fresh high sample, never from old metrics.
    for (const resource of ['cpu', 'memory']) {
      if (
        previous?.[`${resource}Active`] &&
        (resource === 'cpu' ? stat.cpuPercent : stat.memPercent) > 90
      ) {
        const deliveries = await ResourceAlertDelivery.find({
          containerName,
          resource
        }).limit(1)
        if (!deliveries.length) queue[resource] = true
      }
    }

    let lookoutUrl
    let targetLabel = containerName
    if (queue.cpu || queue.memory)
      try {
        const environment = await Environment.findOne({
          id: environmentId
        }).populate('project')
        if (environment?.project?.slug) {
          targetLabel = `${environment.project.slug}/${environment.slug}`
          const baseUrl = sails.config.custom.baseUrl?.replace(/\/$/, '')
          if (baseUrl) {
            lookoutUrl = `${baseUrl}/projects/${
              environment.project.slug
            }/environments/${
              environment.slug
            }/lookout?container=${encodeURIComponent(containerName)}`
          }
        }
      } catch (error) {
        sails.log.verbose(
          'Lookout: Could not resolve alert link:',
          error.message
        )
      }

    // Enqueue first, with a key stable across a crash before the state update.
    for (const resource of ['cpu', 'memory']) {
      if (!queue[resource]) continue
      await sails.helpers.lookout.queueResourceAlert.with({
        previousSampleAt: previous?.lastSampleAt || now,
        payload: {
          containerName,
          cpuPercent: stat.cpuPercent,
          memoryPercent: stat.memPercent,
          memoryUsage: stat.memUsage,
          memoryLimit: stat.memLimit,
          lookoutUrl,
          cpuHigh: resource === 'cpu',
          memHigh: resource === 'memory',
          observedAt: now,
          targetLabel
        }
      })
    }
    if (previous)
      await ResourceAlertState.updateOne({ id: previous.id }).set(state)
    else await ResourceAlertState.create({ containerName, ...state })
  }
}
