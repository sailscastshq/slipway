const deploymentCancellation = require('../../lib/deployment-cancellation')

module.exports = {
  friendlyName: 'Execute rollback',

  description:
    'Run a rollback deployment from an existing image through the shared transactional cutover.',

  inputs: {
    rollbackId: {
      type: 'string',
      required: true
    },
    targetDeployment: {
      type: 'ref',
      required: true
    },
    environment: {
      type: 'ref',
      required: true
    },
    app: {
      type: 'ref'
    },
    leaseToken: {
      type: 'string',
      description: 'Fencing token held by the durable deployment worker.'
    },
    signal: {
      type: 'ref',
      description: 'Abort signal for an operator-requested cancellation.'
    }
  },

  fn: async function ({
    rollbackId,
    targetDeployment,
    environment,
    app: appInput,
    leaseToken,
    signal
  }) {
    let candidateContainerName = null
    let hostPort = null
    let hostPortReserved = false
    let currentStage = 'initialization'

    const recordStage = async (stage, resources = {}) => {
      deploymentCancellation.throwIfCancelled(signal, rollbackId)
      currentStage = stage.replace(/_/g, ' ')
      const result = await sails.helpers.deploy.recordDeploymentStage.with({
        deploymentId: rollbackId,
        leaseToken,
        stage,
        ...resources
      })
      requireValidCoordinatorResult(result)
      deploymentCancellation.throwIfCancelled(signal, rollbackId)
    }

    const assertLease = async () => {
      deploymentCancellation.throwIfCancelled(signal, rollbackId)
      const result = await sails.helpers.deploy.assertDeploymentLease.with({
        deploymentId: rollbackId,
        leaseToken
      })
      requireValidCoordinatorResult(result)
      deploymentCancellation.throwIfCancelled(signal, rollbackId)
    }

    const updateDeployment = async (values) => {
      deploymentCancellation.throwIfCancelled(signal, rollbackId)
      const result = await sails.helpers.deploy.updateDeploymentForLease.with({
        deploymentId: rollbackId,
        leaseToken,
        values
      })
      requireValidCoordinatorResult(result)
      deploymentCancellation.throwIfCancelled(signal, rollbackId)
      return result.deployment
    }

    try {
      await recordStage('initialization', {
        imageName: targetDeployment.imageName
      })
      await updateDeployment({
        status: 'deploying',
        imageName: targetDeployment.imageName
      })

      await Deployment.appendBuildLog(
        rollbackId,
        `Rolling back to deployment ${targetDeployment.id}\n`
      )
      await Deployment.appendBuildLog(
        rollbackId,
        `Reusing image: ${targetDeployment.imageName}\n`
      )

      await sails.helpers.docker.ensureNetwork()

      const existingApp =
        appInput ||
        (await App.findOne({
          environment: environment.id,
          isDefault: true
        })) ||
        (await App.findOne({ environment: environment.id }))
      const appSlug = existingApp?.slug
      const isPubliclyRoutable = !existingApp || existingApp.routePath !== null
      const appBindHost = isPubliclyRoutable
        ? sails.config.custom.slipwayPortHost || '127.0.0.1'
        : '127.0.0.1'
      const healthPath = App.normalizeHealthPath(existingApp?.healthPath)
      const oldContainerName = existingApp?.containerName
      candidateContainerName = await App.generateDeployContainerName(
        environment.id,
        rollbackId,
        appSlug
      )
      await recordStage('container_startup', {
        candidateContainerName,
        previousContainerName: oldContainerName || undefined
      })

      const candidatePreparation =
        await sails.helpers.deploy.prepareCandidateContainer.with({
          deploymentId: rollbackId,
          leaseToken,
          ...(existingApp?.id ? { appId: String(existingApp.id) } : {}),
          containerName: candidateContainerName
        })
      if (candidatePreparation.action === 'current') {
        candidateContainerName = null
        await sails.helpers.deploy.finalizeCurrentCandidate.with({
          deploymentId: rollbackId,
          leaseToken,
          environmentId: String(environment.id),
          appId: String(existingApp.id)
        })
        return
      }
      if (
        candidatePreparation.action !== 'ready' &&
        candidatePreparation.action !== 'removed'
      ) {
        // The app record is the traffic authority. Keep its container out of
        // generic failure cleanup even when the deployment metadata disagrees.
        candidateContainerName = null
        const conflict = new Error(
          `Container ${candidatePreparation.app.containerName} currently owns app traffic and cannot be replaced as a stale candidate.`
        )
        conflict.code = 'DEPLOYMENT_TRAFFIC_OWNER_CONFLICT'
        throw conflict
      }

      hostPort = await sails.helpers.docker.allocatePort.with({
        ownerType: 'deployment',
        ownerId: String(rollbackId)
      })
      hostPortReserved = true
      await recordStage('container_startup', { hostPort })

      const runtimeConfig =
        await sails.helpers.configuration.resolveRuntimeConfig.with({
          environmentId: String(environment.id),
          ...(existingApp?.id ? { appId: String(existingApp.id) } : {})
        })
      const envVars = { ...runtimeConfig.values }
      const envRecord = await Environment.findOne({
        id: environment.id
      }).decrypt()

      if (envRecord.telemetryToken) {
        const telemetryHost =
          sails.config.environment === 'production'
            ? 'slipway'
            : 'host.docker.internal'
        envVars.SLIPWAY_TELEMETRY_URL = `http://${telemetryHost}:1337/api/v1/telemetry/ingest`
        envVars.SLIPWAY_TELEMETRY_TOKEN = envRecord.telemetryToken

        if (existingApp?.id) {
          envVars.SLIPWAY_TELEMETRY_APP_ID = String(existingApp.id)
          envVars.SLIPWAY_TELEMETRY_DEPLOYMENT_ID = String(rollbackId)
        }

        if (existingApp?.id) {
          envVars.SLIPWAY_FLAGS_URL = `http://${telemetryHost}:1337/api/v1/flags/apps/${existingApp.id}`
          envVars.SLIPWAY_FLAGS_TOKEN = envRecord.telemetryToken
          envVars.SLIPWAY_FLAGS_APP_ID = String(existingApp.id)
        }
      }

      if (existingApp?.bridgeEnabled) {
        const bridgeHost =
          sails.config.environment === 'production'
            ? 'slipway'
            : 'host.docker.internal'
        envVars.SLIPWAY_BRIDGE_ENABLED = 'true'
        envVars.SLIPWAY_BRIDGE_EXCHANGE_URL = `http://${bridgeHost}:1337/api/v1/bridge/exchange`
        envVars.SLIPWAY_BRIDGE_APP_ID = String(existingApp.id)
        envVars.SLIPWAY_BRIDGE_ROUTE_PATH = existingApp.routePath || '/'
        envVars.SLIPWAY_BRIDGE_SECRET =
          await sails.helpers.bridge.ensureAppSecret(String(existingApp.id))
      }

      if (existingApp?.bearingEnabled) {
        const bearingHost =
          sails.config.environment === 'production'
            ? 'slipway'
            : 'host.docker.internal'
        envVars.SLIPWAY_BEARING_ENABLED = 'true'
        envVars.SLIPWAY_BEARING_EXCHANGE_URL = `http://${bearingHost}:1337/api/v1/bearing/exchange`
        envVars.SLIPWAY_BEARING_APP_ID = String(existingApp.id)
        envVars.SLIPWAY_BEARING_ROUTE_PATH = existingApp.routePath || '/'
        envVars.SLIPWAY_BEARING_SECRET =
          await sails.helpers.bearing.ensureAppSecret(String(existingApp.id))
      }

      const fingerprint =
        sails.helpers.configuration.fingerprintRuntimeConfig.with({
          values: envVars,
          manifest: runtimeConfig.manifest
        })
      await updateDeployment({
        configHash: fingerprint.hash,
        configManifest: fingerprint.manifest
      })
      await Deployment.appendDeployLog(
        rollbackId,
        `Config: ${fingerprint.hash.slice(0, 12)} (${
          fingerprint.manifest.length
        } variables)\n`
      )

      const containerResult = await sails.helpers.docker.runContainer.with({
        imageName: targetDeployment.imageName,
        containerName: candidateContainerName,
        port: 1337,
        hostPort,
        host: appBindHost,
        envVars,
        deploymentId: rollbackId,
        resourceLimits: existingApp?.resourceLimits,
        signal
      })

      await recordStage('health_check')
      await sails.helpers.docker.healthCheck.with({
        containerName: candidateContainerName,
        port: 1337,
        hostPort,
        path: healthPath,
        deploymentId: rollbackId,
        signal
      })

      await recordStage('traffic_cutover')
      await sails.helpers.deploy.cutoverTraffic.with({
        deploymentId: rollbackId,
        leaseToken,
        environmentId: environment.id,
        appId: existingApp?.id,
        candidate: {
          containerId: containerResult.containerId,
          containerName: candidateContainerName,
          imageName: targetDeployment.imageName,
          port: 1337,
          hostPort,
          slug: appSlug || 'app',
          name: existingApp?.name || appSlug || 'app',
          healthPath,
          routePath: existingApp?.routePath,
          isDefault: existingApp?.isDefault
        }
      })

      candidateContainerName = null
      if (existingApp?.bridgeEnabled) {
        try {
          await sails.helpers.bridge.warmRuntime.with({
            containerName: containerResult.containerName
          })
          await Deployment.appendDeployLog(
            rollbackId,
            `Bridge runtime warmed for ${containerResult.containerName}.\n`
          )
        } catch (error) {
          await Deployment.appendDeployLog(
            rollbackId,
            `Bridge runtime warmup deferred: ${error.message}\n`
          )
        }
      }
      await recordStage('cleanup')
      await releaseDeployPort({ hostPort, deploymentId: rollbackId })
      hostPortReserved = false

      if (
        oldContainerName &&
        oldContainerName !== containerResult.containerName
      ) {
        try {
          await sails.helpers.docker.stopContainer.with({
            containerName: oldContainerName
          })
          await Deployment.appendDeployLog(
            rollbackId,
            `Stopped old container: ${oldContainerName}\n`
          )
        } catch (error) {
          sails.log.verbose(
            `Could not stop old container ${oldContainerName}: ${
              error.message || error
            }`
          )
        }
      }

      await assertLease()
      const stopCriteria = {
        environment: environment.id,
        status: 'running',
        id: { '<': rollbackId }
      }
      if (existingApp) stopCriteria.app = existingApp.id
      await Deployment.update(stopCriteria).set({ status: 'stopped' })

      await updateDeployment({ status: 'running', finishedAt: Date.now() })
      await recordStage('complete')

      const directAccess = await sails.helpers.deploy.getDirectAccess.with({
        serverIp: await sails.helpers.getServerIp(),
        hostPort,
        routePath: existingApp ? existingApp.routePath : '/',
        containerRunning: true,
        portBinding: containerResult.portBinding
      })
      const { accessUrls } = await Environment.resolveAppUrls(environment.id, {
        directUrl: directAccess.url,
        directHint: directAccess.firewallHint
      })
      await Deployment.appendDeployLog(rollbackId, `Rollback complete.\n`)
      for (const accessUrl of accessUrls) {
        await Deployment.appendDeployLog(
          rollbackId,
          `  ${`${accessUrl.logLabel}:`.padEnd(11)}${accessUrl.value}\n`
        )
      }
      if (directAccess.url) {
        await Deployment.appendDeployLog(
          rollbackId,
          `  Network:   Container healthy; ${containerResult.portBinding.diagnostic}\n`
        )
        await Deployment.appendDeployLog(
          rollbackId,
          `  Firewall:  ${directAccess.firewallHint}\n`
        )
      } else if (!isPubliclyRoutable) {
        await Deployment.appendDeployLog(
          rollbackId,
          `  Network:   Worker port is bound to 127.0.0.1 and is not publicly exposed.\n`
        )
      } else if (directAccess.message) {
        await Deployment.appendDeployLog(
          rollbackId,
          `  Network:   ${directAccess.message}\n`
        )
      }

      sails.log.info(`Rollback ${rollbackId} completed successfully`)
    } catch (error) {
      const cancelled =
        deploymentCancellation.isCancellationError(error) || signal?.aborted
      const failure = cancelled
        ? deploymentCancellation.cancellationError(signal, rollbackId)
        : error
      const errorMessage = failure.message || String(failure)
      if (cancelled) {
        sails.log.info(
          `Rollback ${rollbackId} cancelled during ${currentStage}: ${errorMessage}`
        )
      } else {
        sails.log.error(
          `Rollback ${rollbackId} failed during ${currentStage}: ${errorMessage}`
        )
      }

      try {
        await Deployment.appendDeployLog(
          rollbackId,
          cancelled
            ? `\nCancellation acknowledged during ${currentStage}. Cleaning up the candidate release...\n`
            : `\nERROR [${currentStage}]: ${errorMessage}\n`
        )
      } catch {
        /* preserve the original failure */
      }

      if (candidateContainerName) {
        try {
          await sails.helpers.docker.stopContainer.with({
            containerName: candidateContainerName
          })
        } catch {
          /* the candidate may not have started */
        }
      }

      if (hostPortReserved && hostPort) {
        await releaseDeployPort({ hostPort, deploymentId: rollbackId })
      }

      const current = await Deployment.findOne({ id: rollbackId })
      let ownsLease = true
      try {
        await assertLease()
      } catch {
        ownsLease = false
      }
      if (
        current &&
        ownsLease &&
        !['running', 'failed', 'cancelled'].includes(current.status)
      ) {
        await updateDeployment({
          status: 'failed',
          errorMessage,
          finishedAt: Date.now()
        })
      }

      throw failure
    }
  }
}

function requireValidCoordinatorResult(result) {
  if (!result || result.valid !== false) return
  const error = new Error(result.message)
  error.code = result.code
  throw error
}

async function releaseDeployPort({ hostPort, deploymentId }) {
  try {
    await sails.helpers.docker.releasePort.with({
      hostPort,
      ownerType: 'deployment',
      ownerId: String(deploymentId)
    })
  } catch (error) {
    sails.log.warn(
      `Could not release port reservation ${hostPort}: ${
        error.message || error
      }`
    )
  }
}
