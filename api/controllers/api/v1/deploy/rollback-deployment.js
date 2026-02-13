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

  fn: async function ({ projectSlug, environmentSlug, deploymentId }) {
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
      startedAt: Date.now()
    }).fetch()

    sails.log.info(`Rollback ${rollback.id} triggered for ${project.slug}/${environment.slug} → deployment ${deploymentId}`)

    // Kick off the async rollback pipeline
    process.nextTick(() => {
      executeRollback(rollback.id, targetDeployment, project, environment)
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
async function executeRollback(rollbackId, targetDeployment, project, environment) {
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
    const containerName = await App.generateContainerName(environment.id)

    // 4. Allocate a host port
    const hostPort = await sails.helpers.docker.allocatePort()

    // 5. Get env vars
    const envRecord = await Environment.findOne({ id: environment.id }).decrypt()
    const envVars = envRecord.envVars || {}

    // 6. Check for existing app
    const existingApp = await App.findOne({ environment: environment.id })

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
        currentDeployment: rollbackId
      })
    }

    // 9. Update Caddy reverse proxy route
    try {
      await sails.helpers.caddy.updateRoute(environment.id)
    } catch (caddyErr) {
      sails.log.warn(`Caddy route update failed (non-fatal): ${caddyErr.message}`)
      await Deployment.appendDeployLog(rollbackId, `Warning: Caddy route update failed: ${caddyErr.message}\n`)
    }

    // 10. Mark previous running deployments as stopped
    await Deployment.update({ environment: environment.id, status: 'running', id: { '!=': rollbackId } })
      .set({ status: 'stopped' })

    // 11. Mark deployment as running
    await Deployment.updateOne({ id: rollbackId }).set({
      status: 'running',
      finishedAt: Date.now()
    })

    const domain = await Environment.getFullDomain(environment.id)
    await Deployment.appendDeployLog(rollbackId, `Rollback complete.\n`)
    await Deployment.appendDeployLog(rollbackId, `  URL:       https://${domain}\n`)
    await Deployment.appendDeployLog(rollbackId, `  Direct:    http://localhost:${containerResult.hostPort}\n`)

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
