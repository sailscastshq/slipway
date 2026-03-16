module.exports = {
  friendlyName: 'Rollback deployment',

  description: 'Roll back to a previous deployment by reusing its Docker image.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production',
      description: 'Environment slug'
    },
    deploymentId: {
      type: 'string',
      required: true,
      description: 'ID of the deployment to roll back to'
    },
    appSlug: {
      type: 'string',
      description: 'Target app slug (defaults to default app)'
    }
  },

  exits: {
    success: {
      statusCode: 202
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ projectSlug, environmentSlug, deploymentId, appSlug }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug: projectSlug }).populate('team')

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({ project: project.id, slug: environmentSlug })

    if (!environment) {
      throw 'notFound'
    }

    // Resolve target app
    let targetApp
    if (appSlug) {
      targetApp = await App.findOne({ environment: environment.id, slug: appSlug })
    } else {
      targetApp = await App.findOne({ environment: environment.id, isDefault: true })
        || await App.findOne({ environment: environment.id })
    }

    // Find the target deployment to roll back to
    const targetDeployment = await Deployment.findOne({
      id: deploymentId,
      environment: environment.id,
      status: 'running'
    })

    if (!targetDeployment || !targetDeployment.imageName) {
      throw 'badRequest'
    }

    // Create a new deployment record for the rollback
    const rollback = await Deployment.create({
      status: 'pending',
      gitCommit: targetDeployment.gitCommit,
      gitBranch: targetDeployment.gitBranch,
      gitMessage: `Rollback to deployment ${targetDeployment.id}`,
      triggeredBy: user.id,
      triggerType: 'api',
      environment: environment.id,
      app: targetApp ? targetApp.id : undefined,
      startedAt: Date.now()
    }).fetch()

    sails.log.info(`Rollback ${rollback.id} triggered for ${project.slug}/${environment.slug} → deployment ${deploymentId}`)

    // Kick off the async rollback pipeline
    process.nextTick(() => {
      executeRollback(rollback.id, targetDeployment, project, environment, targetApp)
    })

    return {
      deployment: {
        id: rollback.id,
        status: 'pending',
        message: 'Rollback started'
      }
    }
  }
}

/**
 * Async rollback pipeline. Skips the build step — reuses an existing image.
 */
async function executeRollback(rollbackId, targetDeployment, project, environment, targetApp) {
  try {
    // 1. Set status to deploying (no build needed)
    await Deployment.updateOne({ id: rollbackId }).set({
      status: 'deploying',
      imageName: targetDeployment.imageName
    })

    await Deployment.appendBuildLog(rollbackId, `Rolling back to deployment ${targetDeployment.id}\n`)
    await Deployment.appendBuildLog(rollbackId, `Reusing image: ${targetDeployment.imageName}\n`)

    // 2. Ensure Docker network exists
    await sails.helpers.docker.ensureNetwork()

    // 3. Generate container name
    const appSlugForName = targetApp ? targetApp.slug : undefined
    const containerName = await App.generateContainerName(environment.id, appSlugForName)

    // 4. Allocate a host port
    const hostPort = await sails.helpers.docker.allocatePort()

    // 5. Get env vars (3-tier merge: global < environment < app)
    let globalEnvVars = {}
    try {
      const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
      globalEnvVars = JSON.parse(globalJson)
    } catch { /* ignore */ }

    const envRecord = await Environment.findOne({ id: environment.id }).decrypt()
    const appEnvVars = (targetApp && targetApp.envVars) || {}
    const envVars = { ...globalEnvVars, ...(envRecord.envVars || {}), ...appEnvVars }

    // 6. Check for existing app
    const existingApp = targetApp
      || await App.findOne({ environment: environment.id, isDefault: true })
      || await App.findOne({ environment: environment.id })

    // 7. Run the container with the existing image
    const containerResult = await sails.helpers.docker.runContainer.with({
      imageName: targetDeployment.imageName,
      containerName,
      port: 1337,
      hostPort,
      envVars,
      deploymentId: rollbackId
    })

    // 8. Create or update the App record
    if (existingApp) {
      await App.updateOne({ id: existingApp.id }).set({
        status: 'running',
        containerId: containerResult.containerId,
        containerName: containerResult.containerName,
        imageId: null,
        imageName: targetDeployment.imageName,
        port: 1337,
        hostPort: containerResult.hostPort,
        lastDeployedAt: Date.now(),
        currentDeployment: rollbackId
      })
    } else {
      await App.create({
        status: 'running',
        containerId: containerResult.containerId,
        containerName: containerResult.containerName,
        imageName: targetDeployment.imageName,
        port: 1337,
        hostPort: containerResult.hostPort,
        lastDeployedAt: Date.now(),
        environment: environment.id,
        currentDeployment: rollbackId,
        slug: appSlugForName || 'app',
        name: appSlugForName || 'app',
        isDefault: true
      })
    }

    // 9. Update Caddy reverse proxy route
    try {
      await sails.helpers.caddy.updateRoute(environment.id)
    } catch (caddyErr) {
      sails.log.warn(`Caddy route update failed (non-fatal): ${caddyErr.message}`)
      await Deployment.appendDeployLog(rollbackId, `Warning: Caddy route update failed: ${caddyErr.message}\n`)
    }

    // 10. Mark previous running deployments as stopped (scoped to app)
    const stopCriteria = { environment: environment.id, status: 'running', id: { '!=': rollbackId } }
    if (existingApp) stopCriteria.app = existingApp.id
    await Deployment.update(stopCriteria).set({ status: 'stopped' })

    // 11. Mark deployment as running
    await Deployment.updateOne({ id: rollbackId }).set({
      status: 'running',
      finishedAt: Date.now()
    })

    const { fullDomain, generatedDomain } = await Environment.resolveDomains(environment.id)
    const directUrl = targetApp && targetApp.routePath === null
      ? null
      : `http://${await sails.helpers.getServerIp()}:${containerResult.hostPort}`
    await Deployment.appendDeployLog(rollbackId, `Rollback complete.\n`)
    if (fullDomain) {
      await Deployment.appendDeployLog(rollbackId, `  URL:       https://${fullDomain}\n`)
    }
    if (generatedDomain && generatedDomain !== fullDomain) {
      await Deployment.appendDeployLog(rollbackId, `  Fallback:  https://${generatedDomain}\n`)
    }
    if (directUrl) {
      await Deployment.appendDeployLog(rollbackId, `  Direct:    ${directUrl}\n`)
    }

    sails.log.info(`Rollback ${rollbackId} completed successfully`)
  } catch (err) {
    sails.log.error(`Rollback ${rollbackId} failed: ${err.message}`)

    const current = await Deployment.findOne({ id: rollbackId })
    if (current && current.status !== 'failed') {
      await Deployment.updateOne({ id: rollbackId }).set({
        status: 'failed',
        errorMessage: err.message,
        finishedAt: Date.now()
      })
    }
  }
}
