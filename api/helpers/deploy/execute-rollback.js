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
    }
  },

  fn: async function ({
    rollbackId,
    targetDeployment,
    environment,
    app: appInput
  }) {
    let candidateContainerName = null
    let hostPort = null
    let hostPortReserved = false
    let currentStage = 'initialization'

    try {
      await Deployment.updateOne({ id: rollbackId }).set({
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
        ? sails.config.custom.slipwayPortHost || '0.0.0.0'
        : '127.0.0.1'
      const healthPath = App.normalizeHealthPath(existingApp?.healthPath)
      const oldContainerName = existingApp?.containerName
      candidateContainerName = await App.generateDeployContainerName(
        environment.id,
        rollbackId,
        appSlug
      )

      hostPort = await sails.helpers.docker.allocatePort.with({
        ownerType: 'deployment',
        ownerId: String(rollbackId)
      })
      hostPortReserved = true

      let globalEnvVars = {}
      try {
        const globalJson = await sails.helpers.setting.get(
          'globalEnvVars',
          '{}'
        )
        globalEnvVars = JSON.parse(globalJson)
      } catch {
        /* ignore invalid legacy settings */
      }

      const envRecord = await Environment.findOne({
        id: environment.id
      }).decrypt()
      const envVars = {
        ...globalEnvVars,
        ...(envRecord.envVars || {}),
        ...(existingApp?.envVars || {})
      }

      currentStage = 'container startup'
      const containerResult = await sails.helpers.docker.runContainer.with({
        imageName: targetDeployment.imageName,
        containerName: candidateContainerName,
        port: 1337,
        hostPort,
        host: appBindHost,
        envVars,
        deploymentId: rollbackId,
        resourceLimits: existingApp?.resourceLimits
      })

      currentStage = 'health check'
      await sails.helpers.docker.healthCheck.with({
        containerName: candidateContainerName,
        port: 1337,
        hostPort,
        path: healthPath,
        deploymentId: rollbackId
      })

      currentStage = 'traffic cutover'
      await sails.helpers.deploy.cutoverTraffic.with({
        deploymentId: rollbackId,
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

      await releaseDeployPort({ hostPort, deploymentId: rollbackId })
      hostPortReserved = false
      candidateContainerName = null

      currentStage = 'cleanup'
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

      const stopCriteria = {
        environment: environment.id,
        status: 'running',
        id: { '!=': rollbackId }
      }
      if (existingApp) stopCriteria.app = existingApp.id
      await Deployment.update(stopCriteria).set({ status: 'stopped' })

      await Deployment.updateOne({ id: rollbackId }).set({
        status: 'running',
        finishedAt: Date.now()
      })

      const { fullDomain, generatedDomain } = await Environment.resolveDomains(
        environment.id
      )
      const directAccess = await sails.helpers.deploy.getDirectAccess.with({
        serverIp: await sails.helpers.getServerIp(),
        hostPort,
        routePath: existingApp ? existingApp.routePath : '/',
        containerRunning: true,
        portBinding: containerResult.portBinding
      })
      await Deployment.appendDeployLog(rollbackId, `Rollback complete.\n`)
      if (fullDomain) {
        await Deployment.appendDeployLog(
          rollbackId,
          `  URL:       https://${fullDomain}\n`
        )
      }
      if (generatedDomain && generatedDomain !== fullDomain) {
        await Deployment.appendDeployLog(
          rollbackId,
          `  Fallback:  https://${generatedDomain}\n`
        )
      }
      if (directAccess.url) {
        await Deployment.appendDeployLog(
          rollbackId,
          `  Direct:    ${directAccess.url}\n`
        )
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
      const errorMessage = error.message || String(error)
      sails.log.error(
        `Rollback ${rollbackId} failed during ${currentStage}: ${errorMessage}`
      )

      try {
        await Deployment.appendDeployLog(
          rollbackId,
          `\nERROR [${currentStage}]: ${errorMessage}\n`
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
      if (current && current.status !== 'failed') {
        await Deployment.updateOne({ id: rollbackId }).set({
          status: 'failed',
          errorMessage,
          finishedAt: Date.now()
        })
      }

      throw error
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
  } catch (error) {
    sails.log.warn(
      `Could not release port reservation ${hostPort}: ${
        error.message || error
      }`
    )
  }
}
