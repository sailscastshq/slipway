const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

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
    }
  },

  exits: {
    success: {
      description: 'Deployment completed successfully'
    }
  },

  fn: async function ({ deploymentId, project, environment, app: appInput }) {
    let deployContainerName = null
    let deployHostPort = null
    let deployHostPortReserved = false
    let currentStage = 'initialization'

    try {
      const deployment = await Deployment.findOne({ id: deploymentId })

      // 1. Set status to building
      await Deployment.updateOne({ id: deploymentId }).set({
        status: 'building'
      })

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

      // 3. Generate image name and container names
      const imageName = await App.generateImageName(
        environment.id,
        deploymentId,
        appSlug
      )
      const canonicalName = await App.generateContainerName(
        environment.id,
        appSlug
      )
      deployContainerName = await App.generateDeployContainerName(
        environment.id,
        deploymentId,
        appSlug
      )

      currentStage = 'source preparation'
      const { contextPath } =
        await sails.helpers.deploy.ensureBuildContext.with({
          project,
          environment,
          app: targetApp,
          deploymentId,
          gitBranch: deployment?.gitBranch,
          refreshRepository: true
        })

      // 4. Build the Docker image (use app's dockerfilePath, fall back to project's)
      const dockerfilePath =
        (targetApp && targetApp.dockerfilePath) ||
        project.dockerfilePath ||
        'Dockerfile'
      currentStage = 'image build'
      await sails.helpers.docker.buildImage.with({
        contextPath,
        imageName,
        dockerfilePath,
        deploymentId
      })

      // 4b. Detect Sails features (sails-content, sails-quest, etc.)
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
      await Deployment.updateOne({ id: deploymentId }).set({
        imageName,
        status: 'deploying'
      })

      // 6. Allocate a host port
      deployHostPort = await sails.helpers.docker.allocatePort.with({
        ownerType: 'deployment',
        ownerId: String(deploymentId)
      })
      deployHostPortReserved = true

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

      // 9. Run the new container with deploy-scoped name (old container still running)
      currentStage = 'container startup'
      const containerResult = await sails.helpers.docker.runContainer.with({
        imageName,
        containerName: deployContainerName,
        port: 1337,
        hostPort: deployHostPort,
        envVars,
        deploymentId,
        resourceLimits
      })

      // 10. HTTP health check on the new container (Docker DNS, with localhost fallback for local dev)
      currentStage = 'health check'
      await sails.helpers.docker.healthCheck.with({
        containerName: deployContainerName,
        port: 1337,
        hostPort: deployHostPort,
        path: healthPath,
        deploymentId
      })

      // === Health check passed — switch traffic ===

      // 11. Update App record (Caddy reads from this, so traffic switches after updateRoute)
      currentStage = 'traffic cutover'
      if (existingApp) {
        await App.updateOne({ id: existingApp.id }).set({
          status: 'running',
          containerId: containerResult.containerId,
          containerName: canonicalName,
          imageId: null,
          imageName,
          port: 1337,
          hostPort: deployHostPort,
          lastDeployedAt: Date.now(),
          currentDeployment: deploymentId
        })
      } else {
        await App.create({
          status: 'running',
          containerId: containerResult.containerId,
          containerName: canonicalName,
          imageName,
          port: 1337,
          hostPort: deployHostPort,
          lastDeployedAt: Date.now(),
          environment: environment.id,
          currentDeployment: deploymentId,
          slug: appSlug || 'app',
          name: appSlug || 'app',
          healthPath,
          isDefault: true
        })
      }
      await releaseDeployPort({ hostPort: deployHostPort, deploymentId })
      deployHostPortReserved = false

      // 12. Update Caddy reverse proxy route — traffic now goes to new container
      try {
        await sails.helpers.caddy.updateRoute(environment.id)
      } catch (caddyErr) {
        sails.log.warn(
          `Caddy route update failed (non-fatal): ${caddyErr.message}`
        )
        await Deployment.appendDeployLog(
          deploymentId,
          `Warning: Caddy route update failed: ${caddyErr.message}\n`
        )
      }

      // 13. Stop old container (the one with the previous App.containerName)
      currentStage = 'cleanup'
      if (oldContainerName && oldContainerName !== deployContainerName) {
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

      // 14. Rename deploy-scoped container to canonical name
      if (deployContainerName !== canonicalName) {
        try {
          await execFileAsync('docker', [
            'rename',
            deployContainerName,
            canonicalName
          ])
          deployContainerName = null // Renamed, no longer needs cleanup
        } catch (renameErr) {
          sails.log.warn(`Could not rename container: ${renameErr.message}`)
        }
      }

      // 15. Mark previous running deployments as stopped (scoped to this app)
      const stopCriteria = {
        environment: environment.id,
        status: 'running',
        id: { '!=': deploymentId }
      }
      if (existingApp) {
        stopCriteria.app = existingApp.id
      }
      await Deployment.update(stopCriteria).set({ status: 'stopped' })

      // 16. Mark this deployment as running
      await Deployment.updateOne({ id: deploymentId }).set({
        status: 'running',
        finishedAt: Date.now()
      })

      const { fullDomain, generatedDomain } = await Environment.resolveDomains(
        environment.id
      )
      const directUrl =
        targetApp && targetApp.routePath === null
          ? null
          : `http://${await sails.helpers.getServerIp()}:${deployHostPort}`
      await Deployment.appendDeployLog(deploymentId, `Deployment complete.\n`)
      if (fullDomain) {
        await Deployment.appendDeployLog(
          deploymentId,
          `  URL:       https://${fullDomain}\n`
        )
      }
      if (generatedDomain && generatedDomain !== fullDomain) {
        await Deployment.appendDeployLog(
          deploymentId,
          `  Fallback:  https://${generatedDomain}\n`
        )
      }
      if (directUrl) {
        await Deployment.appendDeployLog(
          deploymentId,
          `  Direct:    ${directUrl}\n`
        )
      }

      sails.log.info(
        `Deployment ${deploymentId} completed successfully${
          directUrl ? ` — ${directUrl}` : ''
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
      const errorMessage = err.message || String(err)
      sails.log.error(
        `Deployment ${deploymentId} failed during ${currentStage}: ${errorMessage}`
      )

      // Preserve a useful failure line even when the failing command did not
      // produce stream output (for example source or startup failures).
      try {
        await Deployment.appendDeployLog(
          deploymentId,
          `\nERROR [${currentStage}]: ${errorMessage}\n`
        )
      } catch {
        /* best-effort; the original failure still wins */
      }

      // Capture container logs before removing — shows the actual crash reason
      if (deployContainerName) {
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

      // Mark deployment as failed (only if not already marked by build-image)
      const current = await Deployment.findOne({ id: deploymentId })
      if (current && current.status !== 'failed') {
        await Deployment.updateOne({ id: deploymentId }).set({
          status: 'failed',
          errorMessage,
          finishedAt: Date.now()
        })
      }

      // Send failure notification (fire and forget)
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

      throw err
    }
  }
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
