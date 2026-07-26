const deploymentCancellation = require('../../lib/deployment-cancellation')

module.exports = {
  friendlyName: 'Execute deployment pipeline',

  description:
    'Run the full blue-green deployment pipeline: build, start new container, health check, switch traffic, stop old container.',

  inputs: {
    deploymentId: {
      type: 'string',
      required: true,
      description: 'ID of the Deployment record'
    },
    project: {
      type: 'ref',
      required: true,
      description: 'Project record'
    },
    environment: {
      type: 'ref',
      required: true,
      description: 'Environment record'
    },
    app: {
      type: 'ref',
      description:
        'Target App record (if omitted, resolves default app in environment)'
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

  exits: {
    success: {
      description: 'Deployment completed successfully'
    }
  },

  fn: async function ({
    deploymentId,
    project,
    environment,
    app: appInput,
    leaseToken,
    signal
  }) {
    let deployContainerName = null
    let deployImageName = null
    let deployHostPort = null
    let deployHostPortReserved = false
    let deployBuildContextPath = null
    let currentStage = 'initialization'

    const recordStage = async (stage, resources = {}) => {
      deploymentCancellation.throwIfCancelled(signal, deploymentId)
      currentStage = stage.replace(/_/g, ' ')
      const result = await sails.helpers.deploy.recordDeploymentStage.with({
        deploymentId,
        leaseToken,
        stage,
        ...resources
      })
      requireValidCoordinatorResult(result)
      deploymentCancellation.throwIfCancelled(signal, deploymentId)
    }

    const assertLease = async () => {
      deploymentCancellation.throwIfCancelled(signal, deploymentId)
      const result = await sails.helpers.deploy.assertDeploymentLease.with({
        deploymentId,
        leaseToken
      })
      requireValidCoordinatorResult(result)
      deploymentCancellation.throwIfCancelled(signal, deploymentId)
    }

    const updateDeployment = async (values) => {
      deploymentCancellation.throwIfCancelled(signal, deploymentId)
      const result = await sails.helpers.deploy.updateDeploymentForLease.with({
        deploymentId,
        leaseToken,
        values
      })
      requireValidCoordinatorResult(result)
      deploymentCancellation.throwIfCancelled(signal, deploymentId)
      return result.deployment
    }

    try {
      const deployment = await Deployment.findOne({ id: deploymentId })

      // 1. Set status to building
      await recordStage('initialization')
      await updateDeployment({ status: 'building' })

      // 2. Ensure Docker network exists
      await sails.helpers.docker.ensureNetwork()

      // Resolve target app
      let targetApp = appInput
      if (!targetApp) {
        targetApp =
          (await App.findOne({
            environment: environment.id,
            isDefault: true
          })) || (await App.findOne({ environment: environment.id }))
      }
      const appSlug = targetApp ? targetApp.slug : undefined
      const isPubliclyRoutable = !targetApp || targetApp.routePath !== null
      const appBindHost = isPubliclyRoutable
        ? sails.config.custom.slipwayPortHost || '0.0.0.0'
        : '127.0.0.1'

      // 3. Generate image name and container names
      const imageName = await App.generateImageName(
        environment.id,
        deploymentId,
        appSlug
      )
      deployImageName = imageName
      deployContainerName = await App.generateDeployContainerName(
        environment.id,
        deploymentId,
        appSlug
      )

      await recordStage('source_preparation', {
        candidateContainerName: deployContainerName,
        imageName
      })
      const { contextPath } =
        await sails.helpers.deploy.ensureBuildContext.with({
          project,
          environment,
          app: targetApp,
          deploymentId,
          gitBranch: deployment?.gitBranch,
          gitCommit: deployment?.gitCommit,
          refreshRepository: true,
          signal
        })
      deployBuildContextPath = contextPath

      // 4. Build the Docker image (use app's dockerfilePath, fall back to project's)
      const dockerfilePath =
        (targetApp && targetApp.dockerfilePath) ||
        project.dockerfilePath ||
        'Dockerfile'
      await recordStage('image_build', { buildContextPath: contextPath })
      await sails.helpers.docker.buildImage.with({
        contextPath,
        imageName,
        dockerfilePath,
        deploymentId,
        signal
      })

      // 4b. Detect Sails features (sails-content, sails-quest, etc.)
      await assertLease()
      const detectedFeatures = await sails.helpers.sails.detectFeatures(
        contextPath
      )
      if (Object.keys(detectedFeatures).length > 0) {
        await Environment.updateOne({ id: environment.id }).set({
          features: detectedFeatures
        })
        await Deployment.appendBuildLog(
          deploymentId,
          `Detected features: ${Object.keys(detectedFeatures).join(', ')}\n`
        )
      }

      // 5. Set status to deploying
      await recordStage('container_startup')
      await updateDeployment({ imageName, status: 'deploying' })

      // 6. Allocate a host port
      deployHostPort = await sails.helpers.docker.allocatePort.with({
        ownerType: 'deployment',
        ownerId: String(deploymentId)
      })
      deployHostPortReserved = true
      await recordStage('container_startup', { hostPort: deployHostPort })

      // 7. 3-tier env var merge: global < environment < app-specific
      let globalEnvVars = {}
      try {
        const globalJson = await sails.helpers.setting.get(
          'globalEnvVars',
          '{}'
        )
        globalEnvVars = JSON.parse(globalJson)
      } catch {
        /* ignore parse errors */
      }

      const envRecord = await Environment.findOne({
        id: environment.id
      }).decrypt()
      const appEnvVars = (targetApp && targetApp.envVars) || {}
      const envVars = {
        ...globalEnvVars,
        ...(envRecord.envVars || {}),
        ...appEnvVars
      }

      // 7b. Auto-inject Slipway telemetry env vars for sails-hook-slipway
      if (envRecord.telemetryToken) {
        const telemetryHost =
          sails.config.environment === 'production'
            ? 'slipway'
            : 'host.docker.internal'
        envVars.SLIPWAY_TELEMETRY_URL = `http://${telemetryHost}:1337/api/v1/telemetry/ingest`
        envVars.SLIPWAY_TELEMETRY_TOKEN = envRecord.telemetryToken
      }

      // 8. Get resource limits from existing app
      const existingApp =
        targetApp ||
        (await App.findOne({ environment: environment.id, isDefault: true })) ||
        (await App.findOne({ environment: environment.id }))
      const healthPath = App.normalizeHealthPath(
        (targetApp && targetApp.healthPath) ||
          (existingApp && existingApp.healthPath)
      )
      const resourceLimits = (existingApp && existingApp.resourceLimits) || {
        cpus: '1',
        memory: '1.5g'
      }
      const oldContainerName = existingApp ? existingApp.containerName : null
      await recordStage('container_startup', {
        previousContainerName: oldContainerName || undefined
      })

      // 9. Run the new container with deploy-scoped name (old container still running)
      const containerResult = await sails.helpers.docker.runContainer.with({
        imageName,
        containerName: deployContainerName,
        port: 1337,
        hostPort: deployHostPort,
        host: appBindHost,
        envVars,
        deploymentId,
        resourceLimits,
        signal
      })

      // 10. HTTP health check on the new container (Docker DNS, with localhost fallback for local dev)
      await recordStage('health_check')
      await sails.helpers.docker.healthCheck.with({
        containerName: deployContainerName,
        port: 1337,
        hostPort: deployHostPort,
        path: healthPath,
        deploymentId,
        signal
      })

      // === Health check passed — switch traffic ===

      // 11. Verify the candidate route before committing App state.
      await recordStage('traffic_cutover')
      await sails.helpers.deploy.cutoverTraffic.with({
        deploymentId,
        leaseToken,
        environmentId: environment.id,
        appId: existingApp?.id,
        candidate: {
          containerId: containerResult.containerId,
          containerName: deployContainerName,
          imageName,
          port: 1337,
          hostPort: deployHostPort,
          slug: appSlug || 'app',
          name: existingApp?.name || appSlug || 'app',
          healthPath,
          routePath: existingApp?.routePath,
          isDefault: existingApp?.isDefault
        }
      })
      // The candidate is now canonical. Never remove it from the generic
      // failure cleanup if this worker loses its lease after cutover.
      deployContainerName = null

      await recordStage('cleanup')
      await releaseDeployPort({ hostPort: deployHostPort, deploymentId })
      deployHostPortReserved = false

      // 12. Only retire the previous container after route verification and
      // App state commit have both succeeded.
      if (
        oldContainerName &&
        oldContainerName !== containerResult.containerName
      ) {
        try {
          await sails.helpers.docker.stopContainer.with({
            containerName: oldContainerName
          })
          await Deployment.appendDeployLog(
            deploymentId,
            `Stopped old container: ${oldContainerName}\n`
          )
        } catch (stopErr) {
          // Old container may already be gone — not fatal
          sails.log.verbose(
            `Could not stop old container ${oldContainerName}: ${
              stopErr.message || stopErr
            }`
          )
        }
      }

      // 13. Mark previous running deployments as stopped (scoped to this app)
      await assertLease()
      const stopCriteria = {
        environment: environment.id,
        status: 'running',
        id: { '<': deploymentId }
      }
      if (existingApp) {
        stopCriteria.app = existingApp.id
      }
      await Deployment.update(stopCriteria).set({ status: 'stopped' })

      // 14. Mark this deployment as running
      await updateDeployment({ status: 'running', finishedAt: Date.now() })
      await recordStage('complete')

      const directAccess = await sails.helpers.deploy.getDirectAccess.with({
        serverIp: await sails.helpers.getServerIp(),
        hostPort: deployHostPort,
        routePath: targetApp ? targetApp.routePath : '/',
        containerRunning: true,
        portBinding: containerResult.portBinding
      })
      const directUrl = directAccess.url
      const { accessUrls, primaryUrl } = await Environment.resolveAppUrls(
        environment.id,
        {
          directUrl,
          directHint: directAccess.firewallHint
        }
      )
      await Deployment.appendDeployLog(deploymentId, `Deployment complete.\n`)
      for (const accessUrl of accessUrls) {
        await Deployment.appendDeployLog(
          deploymentId,
          `  ${`${accessUrl.logLabel}:`.padEnd(11)}${accessUrl.value}\n`
        )
      }
      if (directUrl) {
        await Deployment.appendDeployLog(
          deploymentId,
          `  Network:   Container healthy; ${containerResult.portBinding.diagnostic}\n`
        )
        await Deployment.appendDeployLog(
          deploymentId,
          `  Firewall:  ${directAccess.firewallHint}\n`
        )
      } else if (!isPubliclyRoutable) {
        await Deployment.appendDeployLog(
          deploymentId,
          `  Network:   Worker port is bound to 127.0.0.1 and is not publicly exposed.\n`
        )
      } else if (directAccess.message) {
        await Deployment.appendDeployLog(
          deploymentId,
          `  Network:   ${directAccess.message}\n`
        )
      }

      sails.log.info(
        `Deployment ${deploymentId} completed successfully${
          primaryUrl ? ` — ${primaryUrl}` : ''
        }`
      )

      // 17. Clear Bridge model cache (schema may have changed)
      try {
        require('../bridge/introspect-models').clearCache(environment.id)
      } catch {
        /* ignore */
      }

      // 18. Send success notification (fire and forget)
      const finalDeployment = await Deployment.findOne({ id: deploymentId })
      sails.helpers.notification.sendDeploymentNotification
        .with({
          deployment: finalDeployment,
          project,
          environment
        })
        .catch((err) => {
          sails.log.debug('Deployment notification failed:', err.message || err)
        })
    } catch (err) {
      const cancelled =
        deploymentCancellation.isCancellationError(err) || signal?.aborted
      const failure = cancelled
        ? deploymentCancellation.cancellationError(signal, deploymentId)
        : err
      const errorMessage = failure.message || String(failure)
      if (cancelled) {
        sails.log.info(
          `Deployment ${deploymentId} cancelled during ${currentStage}: ${errorMessage}`
        )
      } else {
        sails.log.error(
          `Deployment ${deploymentId} failed during ${currentStage}: ${errorMessage}`
        )
      }

      // Preserve a useful failure line even when the failing command did not
      // produce stream output (for example source or startup failures).
      try {
        await Deployment.appendDeployLog(
          deploymentId,
          cancelled
            ? `\nCancellation acknowledged during ${currentStage}. Cleaning up the candidate release...\n`
            : `\nERROR [${currentStage}]: ${errorMessage}\n`
        )
      } catch {
        /* best-effort; the original failure still wins */
      }

      // Capture container logs before removing — shows the actual crash reason
      if (deployContainerName && !cancelled) {
        try {
          const containerLogs =
            await sails.helpers.docker.getContainerLogs.with({
              containerName: deployContainerName,
              tail: 50,
              timestamps: false
            })
          if (containerLogs && containerLogs.trim()) {
            await Deployment.appendDeployLog(
              deploymentId,
              `\n--- Container logs ---\n${containerLogs.trim()}\n`
            )
          }
        } catch {
          // Container may not have started — no logs to capture
        }
      }

      // Rollback: stop and remove the new (unhealthy) container
      if (deployContainerName) {
        try {
          await sails.helpers.docker.stopContainer.with({
            containerName: deployContainerName
          })
          sails.log.info(
            `Rolled back: removed failed container ${deployContainerName}`
          )
        } catch {
          // Container may not exist yet — that's fine
        }
      }

      if (deployHostPortReserved && deployHostPort) {
        await releaseDeployPort({ hostPort: deployHostPort, deploymentId })
        deployHostPortReserved = false
      }

      if (deployImageName && deployContainerName) {
        try {
          await sails.helpers.docker.removeImage.with({
            imageName: deployImageName
          })
        } catch (cleanupError) {
          sails.log.verbose(
            `Could not remove failed image ${deployImageName}: ${
              cleanupError.message || cleanupError
            }`
          )
        }
      }

      if (deployBuildContextPath) {
        try {
          await sails.helpers.deploy.cleanupBuildContext.with({
            contextPath: deployBuildContextPath,
            deploymentId
          })
        } catch (cleanupError) {
          sails.log.verbose(
            `Could not remove temporary build context ${deployBuildContextPath}: ${
              cleanupError.message || cleanupError
            }`
          )
        }
      }

      // Mark deployment as failed only while this worker still owns the
      // fenced lease. A stale worker must not overwrite recovery state.
      const current = await Deployment.findOne({ id: deploymentId })
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

      // Send failure notification (fire and forget)
      if (!cancelled) {
        const failedDeployment = await Deployment.findOne({ id: deploymentId })
        sails.helpers.notification.sendDeploymentNotification
          .with({
            deployment: failedDeployment,
            project,
            environment
          })
          .catch((notifyErr) => {
            sails.log.debug(
              'Deployment notification failed:',
              notifyErr.message || notifyErr
            )
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
  } catch (err) {
    sails.log.warn(
      `Could not release port reservation ${hostPort}: ${err.message || err}`
    )
  }
}
