module.exports = {
  friendlyName: 'Trigger deployment',

  description: 'Trigger a new deployment for an environment.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    environmentSlug: {
      type: 'string',
      required: true,
      description: 'Environment slug'
    },
    gitCommit: {
      type: 'string',
      description: 'Git commit SHA to deploy'
    },
    gitBranch: {
      type: 'string',
      description: 'Git branch to deploy'
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

  fn: async function ({ projectSlug, environmentSlug, gitCommit, gitBranch }) {
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

    // Create deployment record
    const deployment = await Deployment.create({
      status: 'pending',
      gitCommit,
      gitBranch,
      triggeredBy: user.id,
      triggerType: 'api',
      environment: environment.id,
      startedAt: Date.now()
    }).fetch()

    sails.log.info(`Deployment ${deployment.id} triggered for ${project.slug}/${environment.slug}`)

    // Kick off the async deployment pipeline after returning the response
    process.nextTick(() => {
      executeDeployment(deployment.id, project, environment)
    })

    return {
      deployment: {
        id: deployment.id,
        status: 'pending',
        message: 'Deployment started'
      }
    }
  }
}

/**
 * Async deployment pipeline. Runs after the HTTP response is sent.
 * Steps: ensure network → build image → allocate port → run container → update Caddy route
 */
async function executeDeployment(deploymentId, project, environment) {
  try {
    // 1. Set status to building
    await Deployment.updateOne({ id: deploymentId }).set({ status: 'building' })

    // 2. Ensure Docker network exists
    await sails.helpers.docker.ensureNetwork()

    // 3. Generate image name and container name
    const imageName = await App.generateImageName(environment.id, deploymentId)
    const containerName = await App.generateContainerName(environment.id)
    const contextPath = `${sails.config.custom.slipwayAppsDir}/${project.slug}`

    // 4. Build the Docker image
    await sails.helpers.docker.buildImage.with({
      contextPath,
      imageName,
      dockerfilePath: project.dockerfilePath || 'Dockerfile',
      deploymentId
    })

    // Update deployment with image info
    await Deployment.updateOne({ id: deploymentId }).set({
      imageName,
      status: 'deploying'
    })

    // 5. Allocate a host port
    const hostPort = await sails.helpers.docker.allocatePort()

    // 6. Get env vars from the environment record
    const envRecord = await Environment.findOne({ id: environment.id })
    const envVars = envRecord.envVars || {}

    // 7. Check for existing app (to decide create vs update in step 8)
    const existingApp = await App.findOne({ environment: environment.id })

    // 8. Run the container
    const containerResult = await sails.helpers.docker.runContainer.with({
      imageName,
      containerName,
      port: 1337,
      hostPort,
      envVars,
      deploymentId
    })

    // 9. Create or update the App record
    if (existingApp) {
      await App.updateOne({ id: existingApp.id }).set({
        status: 'running',
        containerId: containerResult.containerId,
        containerName: containerResult.containerName,
        imageId: null,
        imageName,
        port: 1337,
        hostPort: containerResult.hostPort,
        lastDeployedAt: Date.now(),
        currentDeployment: deploymentId
      })
    } else {
      await App.create({
        status: 'running',
        containerId: containerResult.containerId,
        containerName: containerResult.containerName,
        imageName,
        port: 1337,
        hostPort: containerResult.hostPort,
        lastDeployedAt: Date.now(),
        environment: environment.id,
        currentDeployment: deploymentId
      })
    }

    // 10. Update Caddy reverse proxy route
    try {
      await sails.helpers.caddy.updateRoute(environment.id)
    } catch (caddyErr) {
      sails.log.warn(`Caddy route update failed (non-fatal): ${caddyErr.message}`)
      await Deployment.appendDeployLog(deploymentId, `Warning: Caddy route update failed: ${caddyErr.message}\n`)
    }

    // 11. Mark deployment as running
    await Deployment.updateOne({ id: deploymentId }).set({
      status: 'running',
      finishedAt: Date.now()
    })

    const domain = await Environment.getFullDomain(environment.id)
    await Deployment.appendDeployLog(deploymentId, `Deployment complete.\n`)
    await Deployment.appendDeployLog(deploymentId, `  Domain:    ${domain}\n`)
    await Deployment.appendDeployLog(deploymentId, `  Direct:    http://localhost:${containerResult.hostPort}\n`)

    sails.log.info(`Deployment ${deploymentId} completed successfully — http://localhost:${containerResult.hostPort}`)
  } catch (err) {
    sails.log.error(`Deployment ${deploymentId} failed: ${err.message}`)

    // Only update if not already marked as failed by a helper
    const current = await Deployment.findOne({ id: deploymentId })
    if (current && current.status !== 'failed') {
      await Deployment.updateOne({ id: deploymentId }).set({
        status: 'failed',
        errorMessage: err.message,
        finishedAt: Date.now()
      })
    }
  }
}
