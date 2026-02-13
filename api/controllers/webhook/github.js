/**
 * GitHub Webhook Handler
 */
module.exports = {
  friendlyName: 'GitHub Webhook',

  description: 'Handle GitHub webhook events (push, PR, delete).',

  inputs: {},

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    }
  },

  fn: async function () {
    const signature = this.req.headers['x-hub-signature-256']
    const event = this.req.headers['x-github-event']
    const deliveryId = this.req.headers['x-github-delivery']
    const payload = this.req.body

    sails.log.info(`[webhook] GitHub ${event} event received (${deliveryId})`)

    // Find repository by external ID
    const repoId = payload.repository?.id
    if (!repoId) {
      sails.log.warn('[webhook] No repository ID in payload')
      return { received: true, action: 'ignored' }
    }

    const repo = await GitRepository.findOne({
      externalId: String(repoId)
    }).populate('provider').populate('environment')

    if (!repo) {
      sails.log.warn(`[webhook] Unknown repository: ${repoId}`)
      return { received: true, action: 'unknown_repo' }
    }

    // Verify webhook signature
    const rawBody = JSON.stringify(payload)
    const isValid = await sails.helpers.git.verifyWebhookSignature(
      rawBody,
      signature,
      repo.webhookSecret
    )

    if (!isValid) {
      sails.log.warn(`[webhook] Invalid signature for repo ${repo.fullName}`)
      throw 'forbidden'
    }

    // Handle event based on type
    switch (event) {
      case 'push':
        return await handlePush(repo, payload)

      case 'pull_request':
        return await handlePullRequest(repo, payload)

      case 'delete':
        return await handleDelete(repo, payload)

      case 'ping':
        sails.log.info(`[webhook] Ping received for ${repo.fullName}`)
        return { received: true, action: 'pong' }

      default:
        sails.log.verbose(`[webhook] Ignoring event: ${event}`)
        return { received: true, action: 'ignored' }
    }
  }
}

/**
 * Handle push events - trigger deployment
 */
async function handlePush(repo, payload) {
  const branch = payload.ref?.replace('refs/heads/', '')
  const commit = payload.after
  const pusher = payload.pusher?.name

  sails.log.info(`[webhook] Push to ${repo.fullName}/${branch} by ${pusher}`)

  // Check if auto-deploy is enabled
  if (!repo.autoDeploy) {
    sails.log.verbose('[webhook] Auto-deploy disabled, skipping')
    return { received: true, action: 'skipped', reason: 'auto_deploy_disabled' }
  }

  // Check branch mapping
  const branchMappings = repo.branchMappings || {}
  const targetEnvSlug = branchMappings[branch]

  if (!targetEnvSlug && branch !== repo.defaultBranch) {
    sails.log.verbose(`[webhook] No mapping for branch ${branch}, skipping`)
    return { received: true, action: 'skipped', reason: 'no_branch_mapping' }
  }

  // Find target environment
  const environment = repo.environment
  if (!environment) {
    sails.log.warn('[webhook] Repository not linked to environment')
    return { received: true, action: 'skipped', reason: 'no_environment' }
  }

  // Trigger deployment
  sails.log.info(`[webhook] Triggering deployment for ${environment.slug}`)

  try {
    const deployment = await Deployment.create({
      status: 'pending',
      triggerType: 'webhook',
      gitCommit: commit,
      gitMessage: payload.head_commit?.message?.substring(0, 200),
      gitBranch: branch,
      environment: environment.id,
      startedAt: Date.now()
    }).fetch()

    // Queue the actual deployment using the same pipeline as the api/v1 webhook
    const path = require('path')
    const envRecord = await Environment.findOne({ id: environment.id }).populate('project')
    const project = envRecord.project

    process.nextTick(async () => {
      try {
        await Deployment.updateOne({ id: deployment.id }).set({ status: 'building' })
        await sails.helpers.docker.ensureNetwork()

        const imageName = await App.generateImageName(environment.id, deployment.id)
        const containerName = await App.generateContainerName(environment.id)
        const contextPath = path.join(sails.config.custom.slipwayAppsDir, project.slug)

        await sails.helpers.docker.buildImage.with({
          contextPath,
          imageName,
          dockerfilePath: project.dockerfilePath || 'Dockerfile',
          deploymentId: deployment.id
        })

        // Detect Sails features
        const detectedFeatures = await sails.helpers.sails.detectFeatures(contextPath)
        if (Object.keys(detectedFeatures).length > 0) {
          await Environment.updateOne({ id: environment.id }).set({ features: detectedFeatures })
        }

        await Deployment.updateOne({ id: deployment.id }).set({ imageName, status: 'deploying' })

        const hostPort = await sails.helpers.docker.allocatePort()

        // Merge global env vars
        let globalEnvVars = {}
        try {
          const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
          globalEnvVars = JSON.parse(globalJson)
        } catch { /* ignore */ }

        const freshEnv = await Environment.findOne({ id: environment.id })
        const envVars = { ...globalEnvVars, ...(freshEnv.envVars || {}) }

        if (freshEnv.telemetryToken) {
          envVars.SLIPWAY_TELEMETRY_URL = `${sails.config.custom.baseUrl}/api/v1/telemetry/ingest`
          envVars.SLIPWAY_TELEMETRY_TOKEN = freshEnv.telemetryToken
        }

        const existingApp = await App.findOne({ environment: environment.id })
        const resourceLimits = (existingApp && existingApp.resourceLimits) || { cpus: '1', memory: '512m' }

        const containerResult = await sails.helpers.docker.runContainer.with({
          imageName, containerName, port: 1337, hostPort, envVars,
          deploymentId: deployment.id, resourceLimits
        })

        if (existingApp) {
          await App.updateOne({ id: existingApp.id }).set({
            status: 'running', containerId: containerResult.containerId,
            containerName: containerResult.containerName, imageName,
            port: 1337, hostPort: containerResult.hostPort,
            lastDeployedAt: Date.now(), currentDeployment: deployment.id
          })
        } else {
          await App.create({
            status: 'running', containerId: containerResult.containerId,
            containerName: containerResult.containerName, imageName,
            port: 1337, hostPort: containerResult.hostPort,
            lastDeployedAt: Date.now(), environment: environment.id,
            currentDeployment: deployment.id
          })
        }

        try { await sails.helpers.caddy.updateRoute(environment.id) } catch { /* non-fatal */ }

        await Deployment.update({ environment: environment.id, status: 'running', id: { '!=': deployment.id } })
          .set({ status: 'stopped' })

        await Deployment.updateOne({ id: deployment.id }).set({ status: 'running', finishedAt: Date.now() })
        sails.log.info(`[webhook] Deploy ${deployment.id} completed`)
      } catch (err) {
        sails.log.error(`[webhook] Deployment ${deployment.id} failed: ${err.message}`)
        const current = await Deployment.findOne({ id: deployment.id })
        if (current && current.status !== 'failed') {
          await Deployment.updateOne({ id: deployment.id }).set({
            status: 'failed', errorMessage: err.message, finishedAt: Date.now()
          })
        }
      }
    })

    return {
      received: true,
      action: 'deployment_queued',
      deploymentId: deployment.id
    }
  } catch (err) {
    sails.log.error(`[webhook] Failed to create deployment: ${err.message}`)
    return { received: true, action: 'error', error: err.message }
  }
}

/**
 * Handle pull request events - preview environments
 */
async function handlePullRequest(repo, payload) {
  const action = payload.action
  const prNumber = payload.pull_request?.number
  const branch = payload.pull_request?.head?.ref

  sails.log.info(`[webhook] PR #${prNumber} ${action} on ${repo.fullName}`)

  if (!repo.autoDeployPreviews) {
    return { received: true, action: 'skipped', reason: 'previews_disabled' }
  }

  // Need the project to create preview environment
  const environment = await Environment.findOne({ id: repo.environment.id || repo.environment }).populate('project')
  if (!environment || !environment.project) {
    return { received: true, action: 'skipped', reason: 'no_project' }
  }
  const project = await Project.findOne({ id: environment.project.id || environment.project })

  switch (action) {
    case 'opened':
    case 'synchronize':
    case 'reopened': {
      const previewEnv = await sails.helpers.preview.createPreviewEnvironment({
        project,
        prNumber,
        branch
      })
      return { received: true, action: 'preview_queued', prNumber, environmentId: previewEnv.id }
    }

    case 'closed':
      await sails.helpers.preview.destroyPreviewEnvironment({
        project,
        prNumber
      })
      return { received: true, action: 'preview_destroyed', prNumber }

    default:
      return { received: true, action: 'ignored' }
  }
}

/**
 * Handle delete events - cleanup
 */
async function handleDelete(repo, payload) {
  const refType = payload.ref_type
  const ref = payload.ref

  sails.log.info(`[webhook] ${refType} "${ref}" deleted on ${repo.fullName}`)

  // TODO: Clean up preview environments for deleted branches

  return { received: true, action: 'cleanup_queued', refType, ref }
}
