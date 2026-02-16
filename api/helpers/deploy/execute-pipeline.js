const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

module.exports = {
  friendlyName: 'Execute deployment pipeline',

  description: 'Run the full blue-green deployment pipeline: build, start new container, health check, switch traffic, stop old container.',

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
      description: 'Target App record (if omitted, resolves default app in environment)'
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

    try {
      // 1. Set status to building
      await Deployment.updateOne({ id: deploymentId }).set({ status: 'building' })

      // 2. Ensure Docker network exists
      await sails.helpers.docker.ensureNetwork()

      // Resolve target app
      let targetApp = appInput
      if (!targetApp) {
        targetApp = await App.findOne({ environment: environment.id, isDefault: true })
          || await App.findOne({ environment: environment.id })
      }
      const appSlug = targetApp ? targetApp.slug : undefined

      // 3. Generate image name and container names
      const imageName = await App.generateImageName(environment.id, deploymentId, appSlug)
      const canonicalName = await App.generateContainerName(environment.id, appSlug)
      deployContainerName = await App.generateDeployContainerName(environment.id, deploymentId, appSlug)
      const contextPath = require('path').join(sails.config.custom.slipwayAppsDir, project.slug)

      // 4. Build the Docker image (use app's dockerfilePath, fall back to project's)
      const dockerfilePath = (targetApp && targetApp.dockerfilePath) || project.dockerfilePath || 'Dockerfile'
      await sails.helpers.docker.buildImage.with({
        contextPath,
        imageName,
        dockerfilePath,
        deploymentId
      })

      // 4b. Detect Sails features (sails-content, sails-quest, etc.)
      const detectedFeatures = await sails.helpers.sails.detectFeatures(contextPath)
      if (Object.keys(detectedFeatures).length > 0) {
        await Environment.updateOne({ id: environment.id }).set({
          features: detectedFeatures
        })
        await Deployment.appendBuildLog(deploymentId, `Detected features: ${Object.keys(detectedFeatures).join(', ')}\n`)
      }

      // 5. Set status to deploying
      await Deployment.updateOne({ id: deploymentId }).set({
        imageName,
        status: 'deploying'
      })

      // 6. Allocate a host port
      deployHostPort = await sails.helpers.docker.allocatePort()

      // 7. 3-tier env var merge: global < environment < app-specific
      let globalEnvVars = {}
      try {
        const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
        globalEnvVars = JSON.parse(globalJson)
      } catch { /* ignore parse errors */ }

      const envRecord = await Environment.findOne({ id: environment.id }).decrypt()
      const appEnvVars = (targetApp && targetApp.envVars) || {}
      const envVars = { ...globalEnvVars, ...(envRecord.envVars || {}), ...appEnvVars }

      // 7b. Auto-inject Slipway telemetry env vars for sails-hook-slipway
      if (envRecord.telemetryToken) {
        envVars.SLIPWAY_TELEMETRY_URL = `${sails.config.custom.baseUrl}/api/v1/telemetry/ingest`
        envVars.SLIPWAY_TELEMETRY_TOKEN = envRecord.telemetryToken
      }

      // 8. Get resource limits from existing app
      const existingApp = targetApp || await App.findOne({ environment: environment.id, isDefault: true }) || await App.findOne({ environment: environment.id })
      const resourceLimits = (existingApp && existingApp.resourceLimits) || { cpus: '1', memory: '1.5g' }
      const oldContainerName = existingApp ? existingApp.containerName : null

      // 9. Run the new container with deploy-scoped name (old container still running)
      const containerResult = await sails.helpers.docker.runContainer.with({
        imageName,
        containerName: deployContainerName,
        port: 1337,
        hostPort: deployHostPort,
        envVars,
        deploymentId,
        resourceLimits
      })

      // 10. HTTP health check on the new container (via Docker network DNS)
      await sails.helpers.docker.healthCheck.with({
        containerName: deployContainerName,
        port: 1337,
        deploymentId
      })

      // === Health check passed — switch traffic ===

      // 11. Update App record (Caddy reads from this, so traffic switches after updateRoute)
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
          isDefault: true
        })
      }

      // 12. Update Caddy reverse proxy route — traffic now goes to new container
      try {
        await sails.helpers.caddy.updateRoute(environment.id)
      } catch (caddyErr) {
        sails.log.warn(`Caddy route update failed (non-fatal): ${caddyErr.message}`)
        await Deployment.appendDeployLog(deploymentId, `Warning: Caddy route update failed: ${caddyErr.message}\n`)
      }

      // 13. Stop old container (the one with the previous App.containerName)
      if (oldContainerName && oldContainerName !== deployContainerName) {
        try {
          await sails.helpers.docker.stopContainer.with({ containerName: oldContainerName })
          await Deployment.appendDeployLog(deploymentId, `Stopped old container: ${oldContainerName}\n`)
        } catch (stopErr) {
          // Old container may already be gone — not fatal
          sails.log.verbose(`Could not stop old container ${oldContainerName}: ${stopErr.message || stopErr}`)
        }
      }

      // 14. Rename deploy-scoped container to canonical name
      if (deployContainerName !== canonicalName) {
        try {
          await execFileAsync('docker', ['rename', deployContainerName, canonicalName])
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

      const domain = await Environment.getFullDomain(environment.id)
      await Deployment.appendDeployLog(deploymentId, `Deployment complete.\n`)
      await Deployment.appendDeployLog(deploymentId, `  URL:       https://${domain}\n`)
      await Deployment.appendDeployLog(deploymentId, `  Direct:    http://localhost:${deployHostPort}\n`)

      sails.log.info(`Deployment ${deploymentId} completed successfully — http://localhost:${deployHostPort}`)

      // 17. Clear Bridge model cache (schema may have changed)
      try {
        require('../bridge/introspect-models').clearCache(environment.id)
      } catch { /* ignore */ }

      // 18. Send success notification (fire and forget)
      const finalDeployment = await Deployment.findOne({ id: deploymentId })
      sails.helpers.notification.sendDeploymentNotification.with({
        deployment: finalDeployment,
        project,
        environment
      }).catch(err => {
        sails.log.debug('Deployment notification failed:', err.message || err)
      })

    } catch (err) {
      sails.log.error(`Deployment ${deploymentId} failed: ${err.message || err}`)

      // Rollback: stop and remove the new (unhealthy) container if it was started
      if (deployContainerName) {
        try {
          await sails.helpers.docker.stopContainer.with({ containerName: deployContainerName })
          sails.log.info(`Rolled back: removed failed container ${deployContainerName}`)
        } catch {
          // Container may not exist yet — that's fine
        }
      }

      // Mark deployment as failed (only if not already marked by build-image)
      const current = await Deployment.findOne({ id: deploymentId })
      if (current && current.status !== 'failed') {
        await Deployment.updateOne({ id: deploymentId }).set({
          status: 'failed',
          errorMessage: err.message || String(err),
          finishedAt: Date.now()
        })
      }

      // Send failure notification (fire and forget)
      const failedDeployment = await Deployment.findOne({ id: deploymentId })
      sails.helpers.notification.sendDeploymentNotification.with({
        deployment: failedDeployment,
        project,
        environment
      }).catch(notifyErr => {
        sails.log.debug('Deployment notification failed:', notifyErr.message || notifyErr)
      })

      throw err
    }
  }
}
